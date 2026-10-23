import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  max,
  min,
  or,
  sql,
} from "drizzle-orm";
import {
  campaignPdvs,
  campaigns,
  customFieldDefinitions,
  followUps,
  leadContactAttempts,
  leadContacts,
  leadConversions,
  leadEvidences,
  leadSources,
  leadStatuses,
  leadTimelineEvents,
  leadTreatmentGovernance,
  leads,
  partnerSettings,
  pdvs,
  userPartners,
  userPdvAssignments,
  users,
} from "../../drizzle-v2/schema";
import { requirePartnerRole, type PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import { transferLeadResponsibility } from "./distributionService";
import { resolveEffectiveGovernance } from "./governanceService";
import {
  listPartnerLeadSources,
  listPartnerLeadStatuses,
  seedPartnerLeadConfiguration,
} from "./leadConfiguration";
import { requirePdvAdministration } from "./operationalScope";
import { resolvePdvScope } from "./pdvScope";
import {
  portfolioPriorities,
  type PortfolioOperationalFilter,
} from "./leadPortfolioDomain";
import { partnerDayBounds } from "./partnerTime";
import {
  campaignAllowsLeadOperations,
  sellerCanModifyLead,
} from "./leadPolicy";
import { writeV2Audit } from "./partnerService";

const PAGE_MAX = 100;
type LeadRow = typeof leads.$inferSelect;

async function partnerTimezone(db: V2Database, partnerId: number) {
  return (
    (
      await db
        .select({ timezone: partnerSettings.timezone })
        .from(partnerSettings)
        .where(eq(partnerSettings.partnerId, partnerId))
        .limit(1)
    )[0]?.timezone ?? "America/Sao_Paulo"
  );
}

/** Aggregate once per tenant/Lead; never issue a fact query per list row. */
function createPortfolioFacts(db: V2Database, context: PartnerContext) {
  const attempts = db
    .select({
      partnerId: leadContactAttempts.partnerId,
      leadId: leadContactAttempts.leadId,
      attemptCount: count().as("attemptCount"),
      lastAttemptAt: max(leadContactAttempts.occurredAt).as("lastAttemptAt"),
    })
    .from(leadContactAttempts)
    .where(eq(leadContactAttempts.partnerId, context.partnerId))
    .groupBy(leadContactAttempts.partnerId, leadContactAttempts.leadId)
    .as("portfolio_attempt_facts");
  const contacts = db
    .select({
      partnerId: leadContacts.partnerId,
      leadId: leadContacts.leadId,
      lastEffectiveContactAt: max(leadContacts.occurredAt).as(
        "lastEffectiveContactAt"
      ),
    })
    .from(leadContacts)
    .where(
      and(
        eq(leadContacts.partnerId, context.partnerId),
        eq(leadContacts.recordKind, "effective_contact")
      )
    )
    .groupBy(leadContacts.partnerId, leadContacts.leadId)
    .as("portfolio_effective_contact_facts");
  const pendingFollowUps = db
    .select({
      partnerId: followUps.partnerId,
      leadId: followUps.leadId,
      pendingFollowUpCount: count().as("pendingFollowUpCount"),
      // This deliberately does not share the Leads cache column name. The
      // portfolio projection joins both sources, so a distinct derived-column
      // name keeps the MySQL/TiDB CASE, WHERE and ORDER BY expressions
      // unambiguous.
      pendingNextFollowUpAt: min(followUps.dueAt).as("pendingNextFollowUpAt"),
    })
    .from(followUps)
    .where(
      and(
        eq(followUps.partnerId, context.partnerId),
        eq(followUps.status, "pending")
      )
    )
    .groupBy(followUps.partnerId, followUps.leadId)
    .as("portfolio_pending_follow_up_facts");
  const conversions = db
    .select({
      partnerId: leadConversions.partnerId,
      leadId: leadConversions.leadId,
      conversionAt: max(leadConversions.occurredAt).as("conversionAt"),
    })
    .from(leadConversions)
    .where(eq(leadConversions.partnerId, context.partnerId))
    .groupBy(leadConversions.partnerId, leadConversions.leadId)
    .as("portfolio_conversion_facts");
  return { attempts, contacts, pendingFollowUps, conversions };
}

function priorityFromRank(value: unknown) {
  const rank = Number(value);
  return portfolioPriorities[rank - 1] ?? "terminal";
}

function normalizePhone(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits || null;
}

async function scopedPdvIds(db: V2Database, context: PartnerContext) {
  return resolvePdvScope(db, context);
}

async function getLeadInPartner(
  db: V2Database,
  context: PartnerContext,
  leadId: number
) {
  const lead = (
    await db
      .select()
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
  return lead;
}

async function assertLeadVisible(
  db: V2Database,
  context: PartnerContext,
  lead: LeadRow,
  write = false
) {
  const scope = await scopedPdvIds(db, context);
  if (scope && !scope.includes(lead.pdvId))
    throw new Error("Lead não encontrado");
  if (context.role === "seller") {
    if (
      write &&
      !sellerCanModifyLead(lead.assignedMembershipId, context.membershipId)
    )
      throw new Error("Somente o responsável pode alterar este lead");
    if (
      !write &&
      lead.assignedMembershipId !== null &&
      lead.assignedMembershipId !== context.membershipId
    )
      throw new Error("Lead não encontrado");
  }
}

async function assertCampaignOperational(
  db: V2Database,
  context: PartnerContext,
  campaignId: number,
  pdvId: number
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
  if (
    !campaign ||
    !campaignAllowsLeadOperations(campaign.status, campaign.isFrozen)
  )
    throw new Error("A campanha não permite operações de lead neste momento");
  const relation = (
    await db
      .select({ id: campaignPdvs.id })
      .from(campaignPdvs)
      .where(
        and(
          eq(campaignPdvs.partnerId, context.partnerId),
          eq(campaignPdvs.campaignId, campaignId),
          eq(campaignPdvs.pdvId, pdvId),
          eq(campaignPdvs.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!relation) throw new Error("O PDV não participa da campanha");
}

async function writeTimeline(
  db: V2Database,
  input: {
    partnerId: number;
    leadId: number;
    actorMembershipId: number | null;
    type:
      | "lead_created"
      | "assigned"
      | "assignee_changed"
      | "status_changed"
      | "contact"
      | "note"
      | "follow_up_created";
    occurredAt?: Date;
    payload?: Record<string, unknown>;
  }
) {
  const inserted = await db.insert(leadTimelineEvents).values({
    partnerId: input.partnerId,
    leadId: input.leadId,
    actorMembershipId: input.actorMembershipId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date(),
    payloadJson: input.payload ?? null,
    visibility: "partner",
  });
  const timelineEventId = Number(
    (inserted as unknown as [{ insertId?: number }])[0]?.insertId
  );
  if (!timelineEventId)
    throw new Error("Não foi possível registrar a timeline");
  return timelineEventId;
}

async function getActiveStatus(
  db: V2Database,
  partnerId: number,
  statusId: number
) {
  const status = (
    await db
      .select()
      .from(leadStatuses)
      .where(
        and(
          eq(leadStatuses.id, statusId),
          eq(leadStatuses.partnerId, partnerId),
          eq(leadStatuses.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!status) throw new Error("Status inválido para o parceiro atual");
  return status;
}

export async function createLead(
  context: PartnerContext,
  input: {
    campaignId: number;
    pdvId: number;
    statusId: number;
    sourceId?: number | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    customData?: Record<string, unknown> | null;
    receivedAt?: Date | null;
  }
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await assertCampaignOperational(
      transactionDb,
      context,
      input.campaignId,
      input.pdvId
    );
    await getActiveStatus(transactionDb, context.partnerId, input.statusId);
    if (input.sourceId) {
      const source = (
        await transactionDb
          .select({ id: leadSources.id })
          .from(leadSources)
          .where(
            and(
              eq(leadSources.id, input.sourceId),
              eq(leadSources.partnerId, context.partnerId),
              eq(leadSources.isActive, true)
            )
          )
          .limit(1)
      )[0];
      if (!source) throw new Error("Fonte inválida para o parceiro atual");
    }
    const phone = input.phone?.trim() || null;
    const inserted = await tx.insert(leads).values({
      partnerId: context.partnerId,
      campaignId: input.campaignId,
      pdvId: input.pdvId,
      statusId: input.statusId,
      sourceId: input.sourceId ?? null,
      name: input.name?.trim() || null,
      phone,
      normalizedPhone: normalizePhone(phone),
      email: input.email?.trim().toLowerCase() || null,
      customData: input.customData ?? null,
      receivedAt: input.receivedAt ?? new Date(),
      lastActivityAt: new Date(),
    });
    const leadId = Number(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId
    );
    if (!leadId) throw new Error("Não foi possível criar o lead");
    await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId,
      actorMembershipId: context.membershipId,
      type: "lead_created",
      payload: {
        campaignId: input.campaignId,
        pdvId: input.pdvId,
        statusId: input.statusId,
      },
    });
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_created",
      entityType: "lead",
      entityId: leadId,
    });
    return leadId;
  });
}

export async function listLeadConfiguration(context: PartnerContext) {
  const db = await getV2Db();
  return {
    statuses: await listPartnerLeadStatuses(db, context.partnerId),
    sources: await listPartnerLeadSources(db, context.partnerId),
  };
}

export async function initializeLeadConfiguration(context: PartnerContext) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await seedPartnerLeadConfiguration(transactionDb, context.partnerId);
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_configuration_initialized",
      entityType: "partner",
      entityId: context.partnerId,
    });
  });
}

export async function saveLeadStatus(
  context: PartnerContext,
  input: {
    code: string;
    label: string;
    category: "open" | "in_progress" | "completed" | "discarded";
    sortOrder: number;
    isTerminal: boolean;
    isActive: boolean;
  }
) {
  requirePdvAdministration(context);
  const code = input.code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!code || !input.label.trim())
    throw new Error("Código e nome do status são obrigatórios");
  const db = await getV2Db();
  await db
    .insert(leadStatuses)
    .values({
      partnerId: context.partnerId,
      code,
      label: input.label.trim(),
      category: input.category,
      sortOrder: input.sortOrder,
      isTerminal: input.isTerminal,
      isActive: input.isActive,
    })
    .onDuplicateKeyUpdate({
      set: {
        label: input.label.trim(),
        category: input.category,
        sortOrder: input.sortOrder,
        isTerminal: input.isTerminal,
        isActive: input.isActive,
        updatedAt: new Date(),
      },
    });
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "lead_status_saved",
    entityType: "lead_status",
    entityId: code,
  });
}

export async function saveLeadSource(
  context: PartnerContext,
  input: { code: string; label: string; isActive: boolean }
) {
  requirePdvAdministration(context);
  const code = input.code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!code || !input.label.trim())
    throw new Error("Código e nome da fonte são obrigatórios");
  const db = await getV2Db();
  await db
    .insert(leadSources)
    .values({
      partnerId: context.partnerId,
      code,
      label: input.label.trim(),
      isActive: input.isActive,
    })
    .onDuplicateKeyUpdate({
      set: {
        label: input.label.trim(),
        isActive: input.isActive,
        updatedAt: new Date(),
      },
    });
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "lead_source_saved",
    entityType: "lead_source",
    entityId: code,
  });
}

export async function listLeads(
  context: PartnerContext,
  input: {
    view: "available" | "mine" | "all";
    page: number;
    pageSize: number;
    campaignId?: number;
    pdvId?: number;
    statusId?: number;
    assignedMembershipId?: number;
    assignment?: "assigned" | "unassigned";
    firstContact?: "missing" | "recorded";
    operationalFilter?: PortfolioOperationalFilter;
    search?: string;
  }
) {
  const db = await getV2Db();
  const pageSize = Math.min(Math.max(input.pageSize, 1), PAGE_MAX);
  const scope = await scopedPdvIds(db, context);
  if (scope && !scope.length)
    return { items: [], total: 0, page: input.page, pageSize, timezone: null };
  const conditions = [
    eq(leads.partnerId, context.partnerId),
    isNull(leads.deletedAt),
  ];
  if (scope) conditions.push(inArray(leads.pdvId, scope));
  if (input.view === "available")
    conditions.push(isNull(leads.assignedMembershipId));
  if (input.view === "mine")
    conditions.push(eq(leads.assignedMembershipId, context.membershipId!));
  if (input.view === "all" && context.role === "seller")
    conditions.push(
      or(
        isNull(leads.assignedMembershipId),
        eq(leads.assignedMembershipId, context.membershipId!)
      )!
    );
  if (input.campaignId) conditions.push(eq(leads.campaignId, input.campaignId));
  if (input.pdvId) conditions.push(eq(leads.pdvId, input.pdvId));
  if (input.statusId) conditions.push(eq(leads.statusId, input.statusId));
  if (input.assignedMembershipId) {
    conditions.push(eq(leads.assignedMembershipId, input.assignedMembershipId));
  }
  if (input.assignment === "assigned") {
    conditions.push(isNotNull(leads.assignedMembershipId));
  }
  if (input.assignment === "unassigned") {
    conditions.push(isNull(leads.assignedMembershipId));
  }
  if (input.firstContact === "missing") {
    conditions.push(
      and(isNull(leads.firstAttemptAt), isNull(leads.firstEffectiveContactAt))!
    );
  }
  if (input.firstContact === "recorded") {
    conditions.push(
      or(
        isNotNull(leads.firstAttemptAt),
        isNotNull(leads.firstEffectiveContactAt)
      )!
    );
  }
  if (input.search?.trim())
    conditions.push(
      or(
        like(leads.name, `%${input.search.trim()}%`),
        like(leads.phone, `%${input.search.trim()}%`)
      )!
    );
  const where = and(...conditions);
  const operationalFilter = input.operationalFilter ?? "all";
  const fields = {
    id: leads.id,
    campaignId: leads.campaignId,
    pdvId: leads.pdvId,
    statusId: leads.statusId,
    assignedMembershipId: leads.assignedMembershipId,
    name: leads.name,
    phone: leads.phone,
    receivedAt: leads.receivedAt,
    assignedAt: leads.assignedAt,
    firstAttemptAt: leads.firstAttemptAt,
    firstEffectiveContactAt: leads.firstEffectiveContactAt,
    lastActivityAt: leads.lastActivityAt,
    statusLabel: leadStatuses.label,
    statusCategory: leadStatuses.category,
    pdvName: pdvs.name,
    campaignName: campaigns.name,
  };

  // Only the seller portfolio changes behavior in CODEX 030. The available
  // queue and every other view retain their existing chronological query.
  if (input.view !== "mine") {
    const [items, totals] = await Promise.all([
      db
        .select(fields)
        .from(leads)
        .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
        .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
        .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
        .where(where)
        .orderBy(desc(leads.receivedAt), desc(leads.id))
        .limit(pageSize)
        .offset((Math.max(input.page, 1) - 1) * pageSize),
      db.select({ total: count() }).from(leads).where(where),
    ]);
    return {
      items: items.map(item => ({ ...item, operational: null })),
      total: Number(totals[0]?.total ?? 0),
      page: Math.max(input.page, 1),
      pageSize,
      timezone: null,
    };
  }

  const timezone = await partnerTimezone(db, context.partnerId);
  const now = new Date();
  const day = partnerDayBounds(timezone, now);
  const facts = createPortfolioFacts(db, context);
  // Drizzle renders derived-table properties by column alias alone. These are
  // fixed internal SQL identifiers (never client input), qualified here so a
  // future Lead column cannot silently make the outer projection ambiguous.
  const attemptCountFact = sql<number>`\`portfolio_attempt_facts\`.\`attemptCount\``;
  const lastAttemptAtFact = sql<Date | null>`\`portfolio_attempt_facts\`.\`lastAttemptAt\``;
  const lastEffectiveContactAtFact = sql<Date | null>`\`portfolio_effective_contact_facts\`.\`lastEffectiveContactAt\``;
  const pendingFollowUpCountFact = sql<number>`\`portfolio_pending_follow_up_facts\`.\`pendingFollowUpCount\``;
  // `leads.nextFollowUpAt` is an existing Lead cache. Portfolio priority is
  // derived from the explicit MIN(dueAt) over currently pending follow-ups.
  // Keep the derived source qualified throughout the query.
  const pendingNextFollowUpAt = sql<Date | null>`\`portfolio_pending_follow_up_facts\`.\`pendingNextFollowUpAt\``;
  const conversionAtFact = sql<Date | null>`\`portfolio_conversion_facts\`.\`conversionAt\``;
  const attemptCount = sql<number>`coalesce(${attemptCountFact}, 0)`;
  const hasEffectiveContact = sql<number>`case when ${lastEffectiveContactAtFact} is null then 0 else 1 end`;
  const priorityRank = sql<number>`case
    when ${leadStatuses.isTerminal} then 7
    when ${pendingNextFollowUpAt} is not null and ${pendingNextFollowUpAt} < ${now} then 1
    when ${pendingNextFollowUpAt} is not null and ${pendingNextFollowUpAt} >= ${now} and ${pendingNextFollowUpAt} < ${day.end} then 2
    when ${attemptCount} = 0 and ${hasEffectiveContact} = 0 then 3
    when ${hasEffectiveContact} = 0 and ${pendingNextFollowUpAt} is null then 4
    when ${pendingNextFollowUpAt} is not null then 6
    else 5
  end`;
  if (operationalFilter === "action")
    conditions.push(sql`${priorityRank} in (1, 2, 3, 4)`);
  if (operationalFilter === "unworked")
    conditions.push(sql`${priorityRank} = 3`);
  if (operationalFilter === "returns")
    conditions.push(sql`${priorityRank} in (1, 2, 6)`);
  if (operationalFilter === "closed") conditions.push(sql`${priorityRank} = 7`);
  const portfolioWhere = and(...conditions);
  const portfolioFields = {
    ...fields,
    isTerminal: leadStatuses.isTerminal,
    priorityRank: priorityRank.as("priorityRank"),
    attemptCount: attemptCount.as("attemptCount"),
    lastAttemptAt: lastAttemptAtFact.as("lastAttemptAt"),
    hasEffectiveContact: hasEffectiveContact.as("hasEffectiveContact"),
    lastEffectiveContactAt: lastEffectiveContactAtFact.as(
      "lastEffectiveContactAt"
    ),
    nextFollowUpAt: pendingNextFollowUpAt.as("nextFollowUpAt"),
    pendingFollowUpCount:
      sql<number>`coalesce(${pendingFollowUpCountFact}, 0)`.as(
        "pendingFollowUpCount"
      ),
    conversionAt: conversionAtFact.as("conversionAt"),
  };
  const [items, totals] = await Promise.all([
    db
      .select(portfolioFields)
      .from(leads)
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
      .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .leftJoin(
        facts.attempts,
        and(
          eq(facts.attempts.partnerId, leads.partnerId),
          eq(facts.attempts.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.contacts,
        and(
          eq(facts.contacts.partnerId, leads.partnerId),
          eq(facts.contacts.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.pendingFollowUps,
        and(
          eq(facts.pendingFollowUps.partnerId, leads.partnerId),
          eq(facts.pendingFollowUps.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.conversions,
        and(
          eq(facts.conversions.partnerId, leads.partnerId),
          eq(facts.conversions.leadId, leads.id)
        )
      )
      .where(portfolioWhere)
      .orderBy(
        priorityRank,
        sql`case when ${priorityRank} in (1, 2, 6) then ${pendingNextFollowUpAt} end`,
        sql`case when ${priorityRank} = 3 then ${leads.receivedAt} end`,
        sql`case when ${priorityRank} in (4, 5) then coalesce(${leads.lastActivityAt}, ${lastAttemptAtFact}, ${leads.receivedAt}) end`,
        sql`case when ${priorityRank} = 7 then ${leads.lastActivityAt} end desc`,
        asc(leads.id)
      )
      .limit(pageSize)
      .offset((Math.max(input.page, 1) - 1) * pageSize),
    db
      .select({ total: count() })
      .from(leads)
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .leftJoin(
        facts.attempts,
        and(
          eq(facts.attempts.partnerId, leads.partnerId),
          eq(facts.attempts.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.contacts,
        and(
          eq(facts.contacts.partnerId, leads.partnerId),
          eq(facts.contacts.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.pendingFollowUps,
        and(
          eq(facts.pendingFollowUps.partnerId, leads.partnerId),
          eq(facts.pendingFollowUps.leadId, leads.id)
        )
      )
      .where(portfolioWhere),
  ]);
  const ids = items.map(item => item.id);
  const lastAttempts = ids.length
    ? await db
        .select({
          id: leadContactAttempts.id,
          leadId: leadContactAttempts.leadId,
          channel: leadContactAttempts.channel,
          resultLabel: leadContactAttempts.resultLabel,
          occurredAt: leadContactAttempts.occurredAt,
        })
        .from(leadContactAttempts)
        .where(
          and(
            eq(leadContactAttempts.partnerId, context.partnerId),
            inArray(leadContactAttempts.leadId, ids)
          )
        )
        .orderBy(
          asc(leadContactAttempts.leadId),
          desc(leadContactAttempts.occurredAt),
          desc(leadContactAttempts.id)
        )
    : [];
  const lastAttemptByLead = new Map<number, (typeof lastAttempts)[number]>();
  for (const attempt of lastAttempts) {
    if (!lastAttemptByLead.has(attempt.leadId))
      lastAttemptByLead.set(attempt.leadId, attempt);
  }
  return {
    items: items.map(item => {
      const lastAttempt = lastAttemptByLead.get(item.id);
      return {
        ...item,
        operational: {
          priority: priorityFromRank(item.priorityRank),
          attemptCount: Number(item.attemptCount ?? 0),
          lastAttemptAt: item.lastAttemptAt,
          lastAttemptChannel: lastAttempt?.channel ?? null,
          lastAttemptResult: lastAttempt?.resultLabel ?? null,
          hasEffectiveContact: Number(item.hasEffectiveContact) > 0,
          lastEffectiveContactAt: item.lastEffectiveContactAt,
          nextFollowUpAt: item.nextFollowUpAt,
          pendingFollowUpCount: Number(item.pendingFollowUpCount ?? 0),
          isTerminal: item.isTerminal,
          conversionAt: item.conversionAt,
        },
      };
    }),
    total: Number(totals[0]?.total ?? 0),
    page: Math.max(input.page, 1),
    pageSize,
    timezone,
  };
}

export async function getLeadDetail(context: PartnerContext, leadId: number) {
  const db = await getV2Db();
  const lead = await getLeadInPartner(db, context, leadId);
  await assertLeadVisible(db, context, lead);
  const [status] = await db
    .select({
      id: leadStatuses.id,
      label: leadStatuses.label,
      category: leadStatuses.category,
      isTerminal: leadStatuses.isTerminal,
    })
    .from(leadStatuses)
    .where(eq(leadStatuses.id, lead.statusId));
  const [campaign] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      isFrozen: campaigns.isFrozen,
    })
    .from(campaigns)
    .where(eq(campaigns.id, lead.campaignId));
  const [pdv] = await db
    .select({ id: pdvs.id, name: pdvs.name, code: pdvs.code })
    .from(pdvs)
    .where(eq(pdvs.id, lead.pdvId));
  // Include inactive definitions so historical customData remains legible.
  // The Lead visibility assertion above has already applied tenant, PDV and
  // seller ownership scopes before this partner-scoped metadata is read.
  const customFields = await db
    .select({
      key: customFieldDefinitions.key,
      label: customFieldDefinitions.label,
      fieldType: customFieldDefinitions.fieldType,
      sortOrder: customFieldDefinitions.sortOrder,
      isActive: customFieldDefinitions.isActive,
    })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.partnerId, context.partnerId),
        eq(customFieldDefinitions.entityType, "lead")
      )
    )
    .orderBy(
      asc(customFieldDefinitions.sortOrder),
      asc(customFieldDefinitions.label),
      asc(customFieldDefinitions.key)
    );
  const assignee = lead.assignedMembershipId
    ? ((
        await db
          .select({
            membershipId: userPartners.id,
            name: users.name,
            role: userPartners.role,
          })
          .from(userPartners)
          .innerJoin(users, eq(users.id, userPartners.userId))
          .where(
            and(
              eq(userPartners.id, lead.assignedMembershipId),
              eq(userPartners.partnerId, context.partnerId)
            )
          )
          .limit(1)
      )[0] ?? null)
    : null;
  const timeline = await db
    .select()
    .from(leadTimelineEvents)
    .where(
      and(
        eq(leadTimelineEvents.partnerId, context.partnerId),
        eq(leadTimelineEvents.leadId, leadId)
      )
    )
    .orderBy(asc(leadTimelineEvents.occurredAt), asc(leadTimelineEvents.id));
  const contacts = await db
    .select()
    .from(leadContacts)
    .where(
      and(
        eq(leadContacts.partnerId, context.partnerId),
        eq(leadContacts.leadId, leadId)
      )
    )
    .orderBy(desc(leadContacts.occurredAt));
  const scheduledFollowUps = await db
    .select()
    .from(followUps)
    .where(
      and(
        eq(followUps.partnerId, context.partnerId),
        eq(followUps.leadId, leadId)
      )
    )
    .orderBy(asc(followUps.dueAt), asc(followUps.id));
  const actorMembershipIds = Array.from(
    new Set(
      timeline
        .map(event => event.actorMembershipId)
        .filter((membershipId): membershipId is number => membershipId !== null)
    )
  );
  const timelineActors = actorMembershipIds.length
    ? await db
        .select({ membershipId: userPartners.id, name: users.name })
        .from(userPartners)
        .innerJoin(users, eq(users.id, userPartners.userId))
        .where(
          and(
            eq(userPartners.partnerId, context.partnerId),
            inArray(userPartners.id, actorMembershipIds)
          )
        )
    : [];
  const actorNameByMembershipId = new Map(
    timelineActors.map(actor => [actor.membershipId, actor.name])
  );
  const [evidences, governance, effectiveGovernance] = await Promise.all([
    db
      .select({
        id: leadEvidences.id,
        timelineEventId: leadEvidences.timelineEventId,
        fileName: leadEvidences.fileName,
        mimeType: leadEvidences.mimeType,
        sizeBytes: leadEvidences.sizeBytes,
        storageStatus: leadEvidences.storageStatus,
        createdAt: leadEvidences.createdAt,
        deletedAt: leadEvidences.deletedAt,
      })
      .from(leadEvidences)
      .where(
        and(
          eq(leadEvidences.partnerId, context.partnerId),
          eq(leadEvidences.leadId, leadId)
        )
      )
      .orderBy(asc(leadEvidences.createdAt)),
    db
      .select({
        timelineEventId: leadTreatmentGovernance.timelineEventId,
        operationKind: leadTreatmentGovernance.operationKind,
        ruleSource: leadTreatmentGovernance.ruleSource,
        noteSatisfied: leadTreatmentGovernance.noteSatisfied,
        followUpSatisfied: leadTreatmentGovernance.followUpSatisfied,
        evidenceSatisfied: leadTreatmentGovernance.evidenceSatisfied,
        isComplete: leadTreatmentGovernance.isComplete,
      })
      .from(leadTreatmentGovernance)
      .where(
        and(
          eq(leadTreatmentGovernance.partnerId, context.partnerId),
          eq(leadTreatmentGovernance.leadId, leadId)
        )
      ),
    resolveEffectiveGovernance(db, context.partnerId, lead.campaignId),
  ]);
  return {
    lead,
    status,
    campaign,
    pdv,
    customFields,
    assignee,
    timeline: timeline.map(event => ({
      ...event,
      actorName: event.actorMembershipId
        ? (actorNameByMembershipId.get(event.actorMembershipId) ?? null)
        : null,
    })),
    contacts,
    followUps: scheduledFollowUps,
    evidences,
    treatmentGovernance: governance,
    effectiveGovernance,
  };
}

export async function assumeLead(context: PartnerContext, leadId: number) {
  if (context.role !== "seller")
    throw new Error("Apenas vendedores assumem leads da fila");
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const lead = await getLeadInPartner(transactionDb, context, leadId);
    await assertLeadVisible(transactionDb, context, lead);
    await assertCampaignOperational(
      transactionDb,
      context,
      lead.campaignId,
      lead.pdvId
    );
    // Claiming a queue item changes responsibility only. Its commercial
    // status remains independent from the seller's portfolio ownership.
    const result = await tx
      .update(leads)
      .set({
        assignedMembershipId: context.membershipId,
        assignedAt: new Date(),
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.partnerId, context.partnerId),
          isNull(leads.assignedMembershipId),
          isNull(leads.deletedAt)
        )
      );
    const affected = Number(
      (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
    );
    if (affected !== 1)
      throw new Error("Este lead já foi assumido por outro vendedor.");
    await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId,
      actorMembershipId: context.membershipId,
      type: "assigned",
      payload: {
        previousMembershipId: null,
        membershipId: context.membershipId,
      },
    });
    return { leadId, membershipId: context.membershipId };
  });
}

export async function transferLead(
  context: PartnerContext,
  leadId: number,
  nextMembershipId: number,
  reason?: string | null
) {
  // Keep the former domain entry point safe for any internal caller. The
  // distribution service performs tenant/scope validation, conditional owner
  // updates, follow-up transfer and the individual historical events.
  return transferLeadResponsibility(context, leadId, nextMembershipId, reason);
}

export async function addLeadNote(
  context: PartnerContext,
  leadId: number,
  note: string
) {
  const text = note.trim();
  if (!text) throw new Error("A nota não pode ser vazia");
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const lead = await getLeadInPartner(transactionDb, context, leadId);
    await assertLeadVisible(transactionDb, context, lead, true);
    await assertCampaignOperational(
      transactionDb,
      context,
      lead.campaignId,
      lead.pdvId
    );
    await tx
      .update(leads)
      .set({ lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId,
      actorMembershipId: context.membershipId,
      type: "note",
      payload: { text },
    });
  });
}
