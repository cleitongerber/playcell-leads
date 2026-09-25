import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  campaignPdvs,
  campaigns,
  customFieldDefinitions,
  followUps,
  leadDistributionBatches,
  leadSources,
  leadStatuses,
  leadTimelineEvents,
  leadTreatmentGovernance,
  leads,
  pdvs,
  userPartners,
  userPdvAssignments,
  users,
} from "../../drizzle-v2/schema";
import { requirePartnerRole, type PartnerContext } from "./access";
import {
  canAdministrateDistribution,
  distributionSkipMessage,
  normalizeDistributionReason,
  ownerTransitionEligibility,
  planBalancedDistribution,
  queueReturnEligibility,
  type DistributionOperationType,
  type DistributionSkipCode,
  type EligibleSeller,
} from "./distributionDomain";
import { getV2Db, type V2Database } from "./database";
import { campaignAllowsLeadOperations } from "./leadPolicy";
import { writeV2Audit } from "./partnerService";

const PAGE_MAX = 100;
const DISTRIBUTION_BATCH_MAX = 20_000;
const CUSTOM_FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,95}$/;

export type ManagementAssignmentFilter = "all" | "assigned" | "unassigned";

export type LeadManagementFilters = {
  campaignId: number;
  pdvId?: number;
  statusId?: number;
  sourceId?: number;
  assignedMembershipId?: number;
  assignment?: ManagementAssignmentFilter;
  receivedFrom?: Date;
  receivedTo?: Date;
  search?: string;
  customFieldKey?: string;
  customFieldValue?: string;
};

export type DistributionSelection =
  | {
      mode: "ids";
      campaignId: number;
      leadIds: number[];
    }
  | {
      mode: "filtered";
      filters: LeadManagementFilters;
    };

export type LeadDistributionInput = {
  type: DistributionOperationType;
  selection: DistributionSelection;
  membershipId?: number;
  reason?: string | null;
  requestKey: string;
};

type ManagementScope = { pdvIds: number[] | null };
type CandidateLead = {
  id: number;
  campaignId: number;
  pdvId: number;
  assignedMembershipId: number | null;
  receivedAt: Date;
};
type DistributionOutcome =
  | { status: "success" }
  | { status: "skipped"; code: DistributionSkipCode }
  | { status: "failed"; code: string };

function numberOf(value: unknown) {
  return Number(value ?? 0);
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function asSkipSummary(map: Map<string, number>) {
  return Array.from(map.entries()).map(([code, quantity]) => ({
    code,
    quantity,
    message: distributionSkipMessage(code as DistributionSkipCode) ?? code,
  }));
}

async function getManagementScope(
  db: V2Database,
  context: PartnerContext
): Promise<ManagementScope> {
  if (context.role === "super_admin" || context.role === "partner_admin") {
    return { pdvIds: null };
  }
  const rows = await db
    .select({ pdvId: userPdvAssignments.pdvId })
    .from(userPdvAssignments)
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId!),
        eq(userPdvAssignments.isActive, true)
      )
    );
  return { pdvIds: rows.map(row => row.pdvId) };
}

async function getCampaignInScope(
  db: V2Database,
  context: PartnerContext,
  scope: ManagementScope,
  campaignId: number
) {
  const campaign = (
    await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.partnerId, context.partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!campaign) throw new Error("Campanha não encontrada");
  if (scope.pdvIds && !scope.pdvIds.length)
    throw new Error("Campanha não encontrada");
  if (scope.pdvIds) {
    const accessible = (
      await db
        .select({ id: campaignPdvs.id })
        .from(campaignPdvs)
        .where(
          and(
            eq(campaignPdvs.partnerId, context.partnerId),
            eq(campaignPdvs.campaignId, campaignId),
            eq(campaignPdvs.isActive, true),
            inArray(campaignPdvs.pdvId, scope.pdvIds)
          )
        )
        .limit(1)
    )[0];
    if (!accessible) throw new Error("Campanha não encontrada");
  }
  return campaign;
}

async function assertCustomFieldFilter(
  db: V2Database,
  context: PartnerContext,
  filters: LeadManagementFilters
) {
  if (!filters.customFieldKey && !filters.customFieldValue) return;
  if (
    !filters.customFieldKey ||
    !CUSTOM_FIELD_KEY.test(filters.customFieldKey) ||
    filters.customFieldValue == null
  ) {
    throw new Error("Filtro de campo personalizado inválido");
  }
  const field = (
    await db
      .select({ id: customFieldDefinitions.id })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.partnerId, context.partnerId),
          eq(customFieldDefinitions.entityType, "lead"),
          eq(customFieldDefinitions.key, filters.customFieldKey),
          eq(customFieldDefinitions.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!field) throw new Error("Campo personalizado indisponível");
}

function managementConditions(
  context: PartnerContext,
  scope: ManagementScope,
  filters: LeadManagementFilters
) {
  const conditions = [
    eq(leads.partnerId, context.partnerId),
    eq(leads.campaignId, filters.campaignId),
    isNull(leads.deletedAt),
  ];
  if (scope.pdvIds) conditions.push(inArray(leads.pdvId, scope.pdvIds));
  if (filters.pdvId) conditions.push(eq(leads.pdvId, filters.pdvId));
  if (filters.statusId) conditions.push(eq(leads.statusId, filters.statusId));
  if (filters.sourceId) conditions.push(eq(leads.sourceId, filters.sourceId));
  if (filters.assignedMembershipId)
    conditions.push(eq(leads.assignedMembershipId, filters.assignedMembershipId));
  if (filters.assignment === "assigned")
    conditions.push(isNotNull(leads.assignedMembershipId));
  if (filters.assignment === "unassigned")
    conditions.push(isNull(leads.assignedMembershipId));
  if (filters.receivedFrom) conditions.push(gte(leads.receivedAt, filters.receivedFrom));
  if (filters.receivedTo) conditions.push(lte(leads.receivedAt, filters.receivedTo));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        like(leads.name, term),
        like(leads.phone, term),
        like(leads.email, term)
      )!
    );
  }
  if (filters.customFieldKey && filters.customFieldValue != null) {
    const jsonPath = `$.${filters.customFieldKey}`;
    conditions.push(
      sql`json_unquote(json_extract(${leads.customData}, ${jsonPath})) = ${filters.customFieldValue}`
    );
  }
  return conditions;
}

async function loadEligibleSellers(
  db: V2Database,
  partnerId: number,
  scopePdvIds: number[] | null = null
): Promise<Array<EligibleSeller & { name: string }>> {
  if (scopePdvIds && !scopePdvIds.length) return [];
  const conditions = [
    eq(userPartners.partnerId, partnerId),
    eq(userPartners.role, "seller"),
    eq(userPartners.isActive, true),
    eq(users.isActive, true),
    eq(userPdvAssignments.partnerId, partnerId),
    eq(userPdvAssignments.isActive, true),
    eq(pdvs.partnerId, partnerId),
    eq(pdvs.isActive, true),
  ];
  if (scopePdvIds)
    conditions.push(inArray(userPdvAssignments.pdvId, scopePdvIds));
  const rows = await db
    .select({
      membershipId: userPartners.id,
      name: users.name,
      pdvId: userPdvAssignments.pdvId,
    })
    .from(userPartners)
    .innerJoin(users, eq(users.id, userPartners.userId))
    .innerJoin(
      userPdvAssignments,
      and(
        eq(userPdvAssignments.membershipId, userPartners.id),
        eq(userPdvAssignments.partnerId, userPartners.partnerId)
      )
    )
    .innerJoin(
      pdvs,
      and(
        eq(pdvs.id, userPdvAssignments.pdvId),
        eq(pdvs.partnerId, userPdvAssignments.partnerId)
      )
    )
    .where(and(...conditions))
    .orderBy(asc(users.name), asc(userPartners.id));
  const grouped = new Map<
    number,
    EligibleSeller & { name: string }
  >();
  for (const row of rows) {
    const previous = grouped.get(row.membershipId);
    if (previous) {
      if (!previous.pdvIds.includes(row.pdvId)) {
        previous.pdvIds = [...previous.pdvIds, row.pdvId];
      }
      continue;
    }
    grouped.set(row.membershipId, {
      membershipId: row.membershipId,
      name: row.name,
      pdvIds: [row.pdvId],
      activeLeadCount: 0,
    });
  }
  return Array.from(grouped.values());
}

async function withCurrentActiveLoads(
  db: V2Database,
  partnerId: number,
  sellers: Array<EligibleSeller & { name: string }>
) {
  if (!sellers.length) return sellers;
  const ids = sellers.map(seller => seller.membershipId);
  const rows = await db
    .select({
      membershipId: leads.assignedMembershipId,
      total: count(),
    })
    .from(leads)
    .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
    .where(
      and(
        eq(leads.partnerId, partnerId),
        inArray(leads.assignedMembershipId, ids),
        isNull(leads.deletedAt),
        inArray(leadStatuses.category, ["open", "in_progress"])
      )
    )
    .groupBy(leads.assignedMembershipId);
  const counts = new Map(
    rows
      .filter(
        (row): row is typeof row & { membershipId: number } =>
          row.membershipId !== null
      )
      .map(row => [row.membershipId, numberOf(row.total)])
  );
  return sellers.map(seller => ({
    ...seller,
    activeLeadCount: counts.get(seller.membershipId) ?? 0,
  }));
}

export async function listLeadManagementFilters(
  context: PartnerContext,
  campaignId: number
) {
  requirePartnerRole(context, ["super_admin", "partner_admin", "manager"]);
  const db = await getV2Db();
  const scope = await getManagementScope(db, context);
  await getCampaignInScope(db, context, scope, campaignId);
  if (scope.pdvIds && !scope.pdvIds.length)
    return { pdvs: [], statuses: [], sources: [], sellers: [] };
  const pdvConditions = [
    eq(campaignPdvs.partnerId, context.partnerId),
    eq(campaignPdvs.campaignId, campaignId),
    eq(campaignPdvs.isActive, true),
    eq(pdvs.partnerId, context.partnerId),
    eq(pdvs.isActive, true),
  ];
  if (scope.pdvIds) pdvConditions.push(inArray(pdvs.id, scope.pdvIds));
  const [availablePdvs, statuses, sources, sellers] = await Promise.all([
    db
      .select({ id: pdvs.id, name: pdvs.name })
      .from(campaignPdvs)
      .innerJoin(
        pdvs,
        and(
          eq(pdvs.id, campaignPdvs.pdvId),
          eq(pdvs.partnerId, campaignPdvs.partnerId)
        )
      )
      .where(and(...pdvConditions))
      .orderBy(asc(pdvs.name)),
    db
      .select({ id: leadStatuses.id, label: leadStatuses.label })
      .from(leadStatuses)
      .where(
        and(
          eq(leadStatuses.partnerId, context.partnerId),
          eq(leadStatuses.isActive, true)
        )
      )
      .orderBy(asc(leadStatuses.sortOrder), asc(leadStatuses.label)),
    db
      .select({ id: leadSources.id, label: leadSources.label })
      .from(leadSources)
      .where(
        and(
          eq(leadSources.partnerId, context.partnerId),
          eq(leadSources.isActive, true)
        )
      )
      .orderBy(asc(leadSources.label)),
    loadEligibleSellers(db, context.partnerId, scope.pdvIds),
  ]);
  return {
    pdvs: availablePdvs,
    statuses,
    sources,
    sellers: await withCurrentActiveLoads(db, context.partnerId, sellers),
  };
}

export async function listManagedLeads(
  context: PartnerContext,
  input: LeadManagementFilters & { page: number; pageSize: number }
) {
  requirePartnerRole(context, ["super_admin", "partner_admin", "manager"]);
  const db = await getV2Db();
  const scope = await getManagementScope(db, context);
  await getCampaignInScope(db, context, scope, input.campaignId);
  await assertCustomFieldFilter(db, context, input);
  if (scope.pdvIds && !scope.pdvIds.length) {
    return emptyManagementPage(input);
  }
  const conditions = managementConditions(context, scope, input);
  const where = and(...conditions);
  const pageSize = Math.min(Math.max(input.pageSize, 1), PAGE_MAX);
  const page = Math.max(input.page, 1);
  const fields = {
    id: leads.id,
    pdvId: leads.pdvId,
    statusId: leads.statusId,
    sourceId: leads.sourceId,
    assignedMembershipId: leads.assignedMembershipId,
    name: leads.name,
    phone: leads.phone,
    receivedAt: leads.receivedAt,
    lastActivityAt: leads.lastActivityAt,
    nextFollowUpAt: leads.nextFollowUpAt,
    statusLabel: leadStatuses.label,
    statusCategory: leadStatuses.category,
    sourceLabel: leadSources.label,
    pdvName: pdvs.name,
    ownerName: users.name,
  };
  const [items, totals, summary, byPdv, byStatus, sellerMetrics] =
    await Promise.all([
      db
        .select(fields)
        .from(leads)
        .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
        .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
        .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
        .leftJoin(
          userPartners,
          and(
            eq(userPartners.id, leads.assignedMembershipId),
            eq(userPartners.partnerId, leads.partnerId)
          )
        )
        .leftJoin(users, eq(users.id, userPartners.userId))
        .where(where)
        .orderBy(desc(leads.receivedAt), desc(leads.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(leads).innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId)).where(where),
      db
        .select({
          total: count(),
          available: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is null then 1 else 0 end), 0)`,
          assigned: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is not null then 1 else 0 end), 0)`,
          inTreatment: sql<number>`coalesce(sum(case when ${leadStatuses.category} = 'in_progress' then 1 else 0 end), 0)`,
          completed: sql<number>`coalesce(sum(case when ${leadStatuses.category} in ('completed', 'discarded') then 1 else 0 end), 0)`,
        })
        .from(leads)
        .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
        .where(where),
      db
        .select({ pdvId: pdvs.id, label: pdvs.name, total: count() })
        .from(leads)
        .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
        .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
        .where(where)
        .groupBy(pdvs.id, pdvs.name)
        .orderBy(asc(pdvs.name)),
      db
        .select({ statusId: leadStatuses.id, label: leadStatuses.label, total: count() })
        .from(leads)
        .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
        .where(where)
        .groupBy(leadStatuses.id, leadStatuses.label)
        .orderBy(asc(leadStatuses.sortOrder), asc(leadStatuses.label)),
      sellerOverview(db, context, scope, input, where),
    ]);
  const headline = summary[0] ?? {
    total: 0,
    available: 0,
    assigned: 0,
    inTreatment: 0,
    completed: 0,
  };
  return {
    items,
    total: numberOf(totals[0]?.total),
    page,
    pageSize,
    summary: {
      total: numberOf(headline.total),
      available: numberOf(headline.available),
      assigned: numberOf(headline.assigned),
      inTreatment: numberOf(headline.inTreatment),
      completed: numberOf(headline.completed),
      byPdv: byPdv.map(row => ({ ...row, total: numberOf(row.total) })),
      byStatus: byStatus.map(row => ({ ...row, total: numberOf(row.total) })),
      bySeller: sellerMetrics,
    },
  };
}

function emptyManagementPage(input: { page: number; pageSize: number }) {
  return {
    items: [],
    total: 0,
    page: Math.max(input.page, 1),
    pageSize: Math.min(Math.max(input.pageSize, 1), PAGE_MAX),
    summary: {
      total: 0,
      available: 0,
      assigned: 0,
      inTreatment: 0,
      completed: 0,
      byPdv: [],
      byStatus: [],
      bySeller: [],
    },
  };
}

async function sellerOverview(
  db: V2Database,
  context: PartnerContext,
  scope: ManagementScope,
  input: LeadManagementFilters,
  where: ReturnType<typeof and>
) {
  const sellers = await withCurrentActiveLoads(
    db,
    context.partnerId,
    await loadEligibleSellers(db, context.partnerId, scope.pdvIds)
  );
  if (!sellers.length) return [];
  const sellerIds = sellers.map(seller => seller.membershipId);
  const leadRows = await db
    .select({
      membershipId: leads.assignedMembershipId,
      total: count(),
      completed: sql<number>`coalesce(sum(case when ${leadStatuses.category} in ('completed', 'discarded') then 1 else 0 end), 0)`,
    })
    .from(leads)
    .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
    .where(and(where, inArray(leads.assignedMembershipId, sellerIds)))
    .groupBy(leads.assignedMembershipId);
  const now = new Date();
  const followRows = await db
    .select({
      membershipId: followUps.ownerMembershipId,
      overdue: sql<number>`coalesce(sum(case when ${followUps.status} = 'pending' and ${followUps.dueAt} < ${now} then 1 else 0 end), 0)`,
      today: sql<number>`coalesce(sum(case when ${followUps.status} = 'pending' and ${followUps.dueAt} >= ${now} and date(${followUps.dueAt}) = date(${now}) then 1 else 0 end), 0)`,
    })
    .from(followUps)
    .innerJoin(leads, eq(leads.id, followUps.leadId))
    .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
    .where(and(where, inArray(followUps.ownerMembershipId, sellerIds)))
    .groupBy(followUps.ownerMembershipId);
  const leadMap = new Map(
    leadRows
      .filter(
        (row): row is typeof row & { membershipId: number } =>
          row.membershipId !== null
      )
      .map(row => [row.membershipId, row])
  );
  const followMap = new Map(followRows.map(row => [row.membershipId, row]));
  return sellers.map(seller => ({
    membershipId: seller.membershipId,
    name: seller.name,
    pdvIds: seller.pdvIds,
    activeLeadCount: seller.activeLeadCount,
    totalInCampaign: numberOf(leadMap.get(seller.membershipId)?.total),
    completedInCampaign: numberOf(leadMap.get(seller.membershipId)?.completed),
    overdueFollowUps: numberOf(followMap.get(seller.membershipId)?.overdue),
    todayFollowUps: numberOf(followMap.get(seller.membershipId)?.today),
  }));
}

async function resolveSelection(
  db: V2Database,
  context: PartnerContext,
  scope: ManagementScope,
  selection: DistributionSelection
) {
  const filters =
    selection.mode === "filtered"
      ? selection.filters
      : { campaignId: selection.campaignId };
  await getCampaignInScope(db, context, scope, filters.campaignId);
  await assertCustomFieldFilter(db, context, filters);
  if (scope.pdvIds && !scope.pdvIds.length)
    return { filters, requestedCount: selection.mode === "ids" ? 0 : 0, candidates: [] as CandidateLead[], hiddenCount: selection.mode === "ids" ? new Set(selection.leadIds).size : 0 };
  const conditions = managementConditions(context, scope, filters);
  let requestedCount = 0;
  if (selection.mode === "ids") {
    const unique = Array.from(new Set(selection.leadIds));
    if (unique.length > DISTRIBUTION_BATCH_MAX)
      throw new Error(`Selecione no máximo ${DISTRIBUTION_BATCH_MAX} leads por operação`);
    requestedCount = unique.length;
    if (!unique.length)
      return { filters, requestedCount, candidates: [] as CandidateLead[], hiddenCount: 0 };
    conditions.push(inArray(leads.id, unique));
  } else {
    const totals = await db.select({ total: count() }).from(leads).where(and(...conditions));
    requestedCount = numberOf(totals[0]?.total);
    if (requestedCount > DISTRIBUTION_BATCH_MAX) {
      throw new Error(
        `A operação filtrada encontrou mais de ${DISTRIBUTION_BATCH_MAX} leads. Refine os filtros antes de distribuir.`
      );
    }
  }
  const candidates = await db
    .select({
      id: leads.id,
      campaignId: leads.campaignId,
      pdvId: leads.pdvId,
      assignedMembershipId: leads.assignedMembershipId,
      receivedAt: leads.receivedAt,
    })
    .from(leads)
    .where(and(...conditions))
    .orderBy(asc(leads.pdvId), asc(leads.receivedAt), asc(leads.id));
  return {
    filters,
    requestedCount,
    candidates,
    hiddenCount: Math.max(requestedCount - candidates.length, 0),
  };
}

async function findBatchByRequestKey(
  db: V2Database,
  context: PartnerContext,
  requestKey: string
) {
  return (
    await db
      .select()
      .from(leadDistributionBatches)
      .where(
        and(
          eq(leadDistributionBatches.partnerId, context.partnerId),
          eq(leadDistributionBatches.actorUserId, context.userId),
          eq(leadDistributionBatches.requestKey, requestKey)
        )
      )
      .limit(1)
  )[0];
}

function existingBatchResult(batch: typeof leadDistributionBatches.$inferSelect) {
  const metadata =
    batch.metadataJson && typeof batch.metadataJson === "object"
      ? (batch.metadataJson as Record<string, unknown>)
      : {};
  return {
    batchId: batch.id,
    type: batch.type,
    requested: batch.requestedCount,
    processed: batch.processedCount,
    success: batch.successCount,
    skipped: batch.skippedCount,
    failed: batch.failedCount,
    skippedByReason: Array.isArray(metadata.skippedByReason)
      ? metadata.skippedByReason
      : [],
    idempotent: true,
    pending: batch.status === "processing",
  };
}

async function createBatch(
  db: V2Database,
  context: PartnerContext,
  input: LeadDistributionInput,
  campaignId: number,
  requestedCount: number,
  reason: string
) {
  const existing = await findBatchByRequestKey(db, context, input.requestKey);
  if (existing) return { batch: existing, existing: true };
  try {
    const inserted = await db.insert(leadDistributionBatches).values({
      partnerId: context.partnerId,
      campaignId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      requestKey: input.requestKey,
      type: input.type,
      strategy: input.type === "balanced" ? "balanced" : "manual",
      requestedCount,
      metadataJson: {
        campaignId,
        selectionMode: input.selection.mode,
        targetMembershipId: input.membershipId ?? null,
        reason,
      },
    });
    const batchId = numberOf(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId
    );
    const batch = (
      await db
        .select()
        .from(leadDistributionBatches)
        .where(eq(leadDistributionBatches.id, batchId))
        .limit(1)
    )[0];
    if (!batch) throw new Error("Não foi possível iniciar a distribuição");
    return { batch, existing: false };
  } catch (error) {
    const raced = await findBatchByRequestKey(db, context, input.requestKey);
    if (raced) return { batch: raced, existing: true };
    throw error;
  }
}

async function isSellerEligibleForPdv(
  db: V2Database,
  partnerId: number,
  membershipId: number,
  pdvId: number
) {
  const seller = (
    await db
      .select({ id: userPartners.id })
      .from(userPartners)
      .innerJoin(users, eq(users.id, userPartners.userId))
      .innerJoin(
        userPdvAssignments,
        and(
          eq(userPdvAssignments.membershipId, userPartners.id),
          eq(userPdvAssignments.partnerId, userPartners.partnerId)
        )
      )
      .where(
        and(
          eq(userPartners.id, membershipId),
          eq(userPartners.partnerId, partnerId),
          eq(userPartners.role, "seller"),
          eq(userPartners.isActive, true),
          eq(users.isActive, true),
          eq(userPdvAssignments.pdvId, pdvId),
          eq(userPdvAssignments.isActive, true)
        )
      )
      .limit(1)
  )[0];
  return Boolean(seller);
}

async function pendingFollowUpsForLead(
  db: V2Database,
  partnerId: number,
  leadId: number
) {
  return db
    .select({ id: followUps.id, ownerMembershipId: followUps.ownerMembershipId })
    .from(followUps)
    .where(
      and(
        eq(followUps.partnerId, partnerId),
        eq(followUps.leadId, leadId),
        eq(followUps.status, "pending")
      )
    )
    .orderBy(asc(followUps.id));
}

async function hasPendingGovernance(
  db: V2Database,
  partnerId: number,
  leadId: number
) {
  return Boolean(
    (
      await db
        .select({ id: leadTreatmentGovernance.id })
        .from(leadTreatmentGovernance)
        .where(
          and(
            eq(leadTreatmentGovernance.partnerId, partnerId),
            eq(leadTreatmentGovernance.leadId, leadId),
            eq(leadTreatmentGovernance.isComplete, false)
          )
        )
        .limit(1)
    )[0]
  );
}

async function writeDistributionTimeline(
  db: V2Database,
  input: {
    partnerId: number;
    leadId: number;
    actorMembershipId: number | null;
    type:
      | "lead_distributed"
      | "lead_reassigned"
      | "lead_returned_to_queue"
      | "follow_up_owner_changed";
    payload: Record<string, unknown>;
  }
) {
  await db.insert(leadTimelineEvents).values({
    partnerId: input.partnerId,
    leadId: input.leadId,
    actorMembershipId: input.actorMembershipId,
    type: input.type,
    payloadJson: input.payload,
    visibility: "partner",
  });
}

async function processCandidate(
  context: PartnerContext,
  batchId: number,
  type: DistributionOperationType,
  candidate: CandidateLead,
  nextMembershipId: number | undefined,
  reason: string
): Promise<DistributionOutcome> {
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const lead = (
      await transactionDb
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.id, candidate.id),
            eq(leads.partnerId, context.partnerId),
            eq(leads.campaignId, candidate.campaignId),
            isNull(leads.deletedAt)
          )
        )
        .limit(1)
    )[0];
    if (!lead) return { status: "skipped", code: "not_visible_or_not_found" };
    const campaign = (
      await transactionDb
        .select({ status: campaigns.status, isFrozen: campaigns.isFrozen })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.id, lead.campaignId),
            eq(campaigns.partnerId, context.partnerId)
          )
        )
        .limit(1)
    )[0];
    if (!campaign || !campaignAllowsLeadOperations(campaign.status, campaign.isFrozen)) {
      return { status: "failed", code: "campaign_not_operational" };
    }
    const campaignPdv = (
      await transactionDb
        .select({ id: campaignPdvs.id })
        .from(campaignPdvs)
        .innerJoin(
          pdvs,
          and(
            eq(pdvs.id, campaignPdvs.pdvId),
            eq(pdvs.partnerId, campaignPdvs.partnerId)
          )
        )
        .where(
          and(
            eq(campaignPdvs.partnerId, context.partnerId),
            eq(campaignPdvs.campaignId, lead.campaignId),
            eq(campaignPdvs.pdvId, lead.pdvId),
            eq(campaignPdvs.isActive, true),
            eq(pdvs.isActive, true)
          )
        )
        .limit(1)
    )[0];
    if (!campaignPdv) return { status: "failed", code: "pdv_not_operational" };
    const ownerState = ownerTransitionEligibility(
      type,
      lead.assignedMembershipId,
      nextMembershipId
    );
    if (ownerState) return { status: "skipped", code: ownerState };
    if (type === "return_to_queue") {
      const [pendingFollowUps, governancePending] = await Promise.all([
        pendingFollowUpsForLead(transactionDb, context.partnerId, lead.id),
        hasPendingGovernance(transactionDb, context.partnerId, lead.id),
      ]);
      const returnState = queueReturnEligibility({
        hasPendingFollowUp: pendingFollowUps.length > 0,
        hasPendingGovernance: governancePending,
      });
      if (returnState) return { status: "skipped", code: returnState };
    } else if (
      !nextMembershipId ||
      !(await isSellerEligibleForPdv(
        transactionDb,
        context.partnerId,
        nextMembershipId,
        lead.pdvId
      ))
    ) {
      return { status: "skipped", code: "seller_not_eligible" };
    }

    const expectedOwner = lead.assignedMembershipId;
    const conditions = [
      eq(leads.id, lead.id),
      eq(leads.partnerId, context.partnerId),
      eq(leads.campaignId, lead.campaignId),
      isNull(leads.deletedAt),
      expectedOwner === null
        ? isNull(leads.assignedMembershipId)
        : eq(leads.assignedMembershipId, expectedOwner),
    ];
    const now = new Date();
    const update = await tx
      .update(leads)
      .set({
        assignedMembershipId:
          type === "return_to_queue" ? null : nextMembershipId!,
        assignedAt: type === "return_to_queue" ? null : now,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(and(...conditions));
    const affected = numberOf(
      (update as unknown as [{ affectedRows?: number }])[0]?.affectedRows
    );
    if (affected !== 1) return { status: "skipped", code: "changed_concurrently" };

    if (type !== "return_to_queue" && nextMembershipId) {
      const pending = await pendingFollowUpsForLead(
        transactionDb,
        context.partnerId,
        lead.id
      );
      const transferable = pending.filter(
        followUp => followUp.ownerMembershipId !== nextMembershipId
      );
      if (transferable.length) {
        await tx
          .update(followUps)
          .set({ ownerMembershipId: nextMembershipId, updatedAt: now })
          .where(
            and(
              eq(followUps.partnerId, context.partnerId),
              eq(followUps.leadId, lead.id),
              eq(followUps.status, "pending")
            )
          );
        await writeDistributionTimeline(transactionDb, {
          partnerId: context.partnerId,
          leadId: lead.id,
          actorMembershipId: context.membershipId,
          type: "follow_up_owner_changed",
          payload: {
            batchId,
            followUpIds: transferable.map(item => item.id),
            previousOwnerMembershipIds: Array.from(
              new Set(transferable.map(item => item.ownerMembershipId))
            ),
            nextMembershipId,
            reason: "Transferência de responsabilidade do lead",
          },
        });
      }
    }

    const timelineType =
      type === "return_to_queue"
        ? "lead_returned_to_queue"
        : expectedOwner === null
          ? "lead_distributed"
          : "lead_reassigned";
    await writeDistributionTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId: lead.id,
      actorMembershipId: context.membershipId,
      type: timelineType,
      payload: {
        batchId,
        previousMembershipId: expectedOwner,
        nextMembershipId: type === "return_to_queue" ? null : nextMembershipId,
        reason,
        strategy: type === "balanced" ? "balanced" : "manual",
      },
    });
    return { status: "success" };
  });
}

export async function distributeLeads(
  context: PartnerContext,
  input: LeadDistributionInput
) {
  requirePartnerRole(context, ["super_admin", "partner_admin", "manager"]);
  if (!canAdministrateDistribution(context.role))
    throw new Error("Seu perfil não possui permissão para distribuição");
  if (!input.requestKey.trim()) throw new Error("Identificador da operação obrigatório");
  if (
    (input.type === "assign" || input.type === "reassign") &&
    !input.membershipId
  ) {
    throw new Error("Selecione um vendedor para concluir a distribuição");
  }

  const db = await getV2Db();
  const scope = await getManagementScope(db, context);
  const selection = await resolveSelection(db, context, scope, input.selection);
  if (!selection.requestedCount)
    throw new Error("Nenhum lead encontrado para esta operação");
  const campaign = await getCampaignInScope(
    db,
    context,
    scope,
    selection.filters.campaignId
  );
  if (!campaignAllowsLeadOperations(campaign.status, campaign.isFrozen)) {
    throw new Error("A campanha não permite distribuição neste momento");
  }
  const reason = normalizeDistributionReason(input.type, input.reason);
  const created = await createBatch(
    db,
    context,
    input,
    campaign.id,
    selection.requestedCount,
    reason
  );
  if (created.existing) return existingBatchResult(created.batch);

  const skipReasons = new Map<string, number>();
  if (selection.hiddenCount) {
    increment(
      skipReasons,
      "not_visible_or_not_found",
      selection.hiddenCount
    );
  }
  let processed = 0;
  let success = 0;
  let failed = 0;
  let planned = selection.candidates.map(candidate => ({
    candidate,
    membershipId: input.membershipId,
  }));

  if (input.type === "balanced") {
    const eligible = await withCurrentActiveLoads(
      db,
      context.partnerId,
      await loadEligibleSellers(db, context.partnerId, scope.pdvIds)
    );
    const plan = planBalancedDistribution(selection.candidates, eligible);
    for (const skipped of plan.skipped) increment(skipReasons, skipped.code);
    const candidateById = new Map(
      selection.candidates.map(candidate => [candidate.id, candidate])
    );
    planned = plan.assignments.flatMap(assignment => {
      const candidate = candidateById.get(assignment.leadId);
      return candidate
        ? [{ candidate, membershipId: assignment.membershipId }]
        : [];
    });
  }

  for (const item of planned) {
    processed += 1;
    try {
      const outcome = await processCandidate(
        context,
        created.batch.id,
        input.type,
        item.candidate,
        item.membershipId,
        reason
      );
      if (outcome.status === "success") success += 1;
      else if (outcome.status === "skipped") increment(skipReasons, outcome.code);
      else {
        failed += 1;
        increment(skipReasons, outcome.code);
      }
    } catch {
      failed += 1;
      increment(skipReasons, "unexpected_error");
    }
  }

  const skipped = selection.requestedCount - success - failed;
  const skippedByReason = asSkipSummary(skipReasons);
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx
      .update(leadDistributionBatches)
      .set({
        status: "completed",
        processedCount: processed,
        successCount: success,
        skippedCount: Math.max(skipped, 0),
        failedCount: failed,
        metadataJson: {
          campaignId: campaign.id,
          selectionMode: input.selection.mode,
          targetMembershipId: input.membershipId ?? null,
          reason,
          skippedByReason,
        },
        completedAt: new Date(),
      })
      .where(
        and(
          eq(leadDistributionBatches.id, created.batch.id),
          eq(leadDistributionBatches.partnerId, context.partnerId)
        )
      );
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action:
        input.type === "balanced"
          ? "lead_distribution_balanced"
          : input.type === "return_to_queue"
            ? "lead_returned_to_queue_batch"
            : input.type === "reassign"
              ? "lead_redistribution_batch"
              : "lead_distribution_batch",
      entityType: "lead_distribution_batch",
      entityId: created.batch.id,
      metadata: {
        campaignId: campaign.id,
        requested: selection.requestedCount,
        processed,
        success,
        skipped: Math.max(skipped, 0),
        failed,
        strategy: input.type === "balanced" ? "balanced" : "manual",
        targetMembershipId: input.membershipId ?? null,
      },
    });
  });
  return {
    batchId: created.batch.id,
    type: input.type,
    requested: selection.requestedCount,
    processed,
    success,
    skipped: Math.max(skipped, 0),
    failed,
    skippedByReason,
    idempotent: false,
    pending: false,
  };
}

/** Backward-compatible single-lead entry point for the former transfer API. */
export async function transferLeadResponsibility(
  context: PartnerContext,
  leadId: number,
  membershipId: number,
  reason?: string | null
) {
  const db = await getV2Db();
  const lead = (
    await db
      .select({ campaignId: leads.campaignId, assignedMembershipId: leads.assignedMembershipId })
      .from(leads)
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.partnerId, context.partnerId),
          isNull(leads.deletedAt)
        )
      )
      .limit(1)
  )[0];
  if (!lead) throw new Error("Lead não encontrado");
  return distributeLeads(context, {
    type: lead.assignedMembershipId === null ? "assign" : "reassign",
    membershipId,
    reason,
    requestKey: `legacy-transfer-${randomUUID()}`,
    selection: { mode: "ids", campaignId: lead.campaignId, leadIds: [leadId] },
  });
}
