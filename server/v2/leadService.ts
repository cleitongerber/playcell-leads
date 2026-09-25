import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import {
  campaignPdvs,
  campaigns,
  followUps,
  leadContacts,
  leadEvidences,
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
import { getV2Db, type V2Database } from "./database";
import { transferLeadResponsibility } from "./distributionService";
import {
  assertContactGovernance,
  evaluateTreatmentGovernance,
} from "./governancePolicy";
import { resolveEffectiveGovernance } from "./governanceService";
import {
  listPartnerLeadSources,
  listPartnerLeadStatuses,
  seedPartnerLeadConfiguration,
} from "./leadConfiguration";
import { requirePdvAdministration } from "./operationalScope";
import {
  campaignAllowsLeadOperations,
  sellerCanModifyLead,
} from "./leadPolicy";
import { writeV2Audit } from "./partnerService";

const PAGE_MAX = 100;
type LeadRow = typeof leads.$inferSelect;

function normalizePhone(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits || null;
}

async function scopedPdvIds(db: V2Database, context: PartnerContext) {
  if (context.role === "super_admin" || context.role === "partner_admin")
    return null;
  const assignments = await db
    .select({ pdvId: userPdvAssignments.pdvId })
    .from(userPdvAssignments)
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId!),
        eq(userPdvAssignments.isActive, true)
      )
    );
  return assignments.map(row => row.pdvId);
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
    search?: string;
  }
) {
  const db = await getV2Db();
  const pageSize = Math.min(Math.max(input.pageSize, 1), PAGE_MAX);
  const scope = await scopedPdvIds(db, context);
  if (scope && !scope.length)
    return { items: [], total: 0, page: input.page, pageSize };
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
  if (input.search?.trim())
    conditions.push(
      or(
        like(leads.name, `%${input.search.trim()}%`),
        like(leads.phone, `%${input.search.trim()}%`)
      )!
    );
  const where = and(...conditions);
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
    firstContactAt: leads.firstContactAt,
    lastActivityAt: leads.lastActivityAt,
    statusLabel: leadStatuses.label,
    statusCategory: leadStatuses.category,
    pdvName: pdvs.name,
    campaignName: campaigns.name,
  };
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
    items,
    total: Number(totals[0]?.total ?? 0),
    page: Math.max(input.page, 1),
    pageSize,
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
    assignee,
    timeline,
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

export async function changeLeadStatus(
  context: PartnerContext,
  leadId: number,
  statusId: number
) {
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
    const status = await getActiveStatus(
      transactionDb,
      context.partnerId,
      statusId
    );
    await tx
      .update(leads)
      .set({ statusId, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId,
      actorMembershipId: context.membershipId,
      type: "status_changed",
      payload: {
        previousStatusId: lead.statusId,
        statusId,
        statusCode: status.code,
      },
    });
  });
}

export async function recordLeadContact(
  context: PartnerContext,
  leadId: number,
  input: {
    channel: string;
    outcome: string;
    summary?: string | null;
    occurredAt?: Date;
    statusId?: number;
    followUpDueAt?: Date | null;
    followUpNote?: string | null;
  }
) {
  if (!context.membershipId)
    throw new Error("Uma membership ativa é necessária para registrar contato");
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
    const effectiveGovernance = await resolveEffectiveGovernance(
      transactionDb,
      context.partnerId,
      lead.campaignId
    );
    assertContactGovernance(effectiveGovernance.rule, input);
    const occurredAt = input.occurredAt ?? new Date();
    if (input.followUpDueAt && input.followUpDueAt.getTime() <= Date.now()) {
      throw new Error(
        "O próximo follow-up deve ser agendado para uma data futura"
      );
    }
    let newStatus = null;
    if (input.statusId && input.statusId !== lead.statusId)
      newStatus = await getActiveStatus(
        transactionDb,
        context.partnerId,
        input.statusId
      );
    await tx.insert(leadContacts).values({
      partnerId: context.partnerId,
      leadId,
      actorMembershipId: context.membershipId!,
      channel: input.channel.trim(),
      outcome: input.outcome.trim(),
      summary: input.summary?.trim() || null,
      occurredAt,
    });
    await tx
      .update(leads)
      .set({
        statusId: newStatus?.id ?? lead.statusId,
        firstContactAt: sql`coalesce(${leads.firstContactAt}, ${occurredAt})`,
        lastActivityAt: occurredAt,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
    if (newStatus)
      await writeTimeline(transactionDb, {
        partnerId: context.partnerId,
        leadId,
        actorMembershipId: context.membershipId,
        type: "status_changed",
        occurredAt,
        payload: {
          previousStatusId: lead.statusId,
          statusId: newStatus.id,
          statusCode: newStatus.code,
          causedBy: "contact",
        },
      });
    let followUpId: number | null = null;
    if (input.followUpDueAt) {
      const ownerMembershipId =
        lead.assignedMembershipId ?? context.membershipId;
      if (!ownerMembershipId)
        throw new Error("Responsável do follow-up obrigatório");
      const ownerScope = (
        await transactionDb
          .select({ id: userPdvAssignments.id })
          .from(userPdvAssignments)
          .innerJoin(
            userPartners,
            eq(userPartners.id, userPdvAssignments.membershipId)
          )
          .innerJoin(users, eq(users.id, userPartners.userId))
          .where(
            and(
              eq(userPdvAssignments.partnerId, context.partnerId),
              eq(userPdvAssignments.membershipId, ownerMembershipId),
              eq(userPdvAssignments.pdvId, lead.pdvId),
              eq(userPdvAssignments.isActive, true),
              eq(userPartners.isActive, true),
              eq(users.isActive, true)
            )
          )
          .limit(1)
      )[0];
      if (!ownerScope)
        throw new Error("O responsável não possui acesso ativo ao PDV do lead");
      const insertedFollowUp = await tx.insert(followUps).values({
        partnerId: context.partnerId,
        leadId,
        ownerMembershipId,
        dueAt: input.followUpDueAt,
        note: input.followUpNote?.trim() || null,
      });
      followUpId = Number(
        (insertedFollowUp as unknown as [{ insertId?: number }])[0]?.insertId
      );
      if (!followUpId) throw new Error("Não foi possível criar o follow-up");
      await tx
        .update(leads)
        .set({
          nextFollowUpAt: sql`case when ${leads.nextFollowUpAt} is null or ${input.followUpDueAt} < ${leads.nextFollowUpAt} then ${input.followUpDueAt} else ${leads.nextFollowUpAt} end`,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));
      await writeTimeline(transactionDb, {
        partnerId: context.partnerId,
        leadId,
        actorMembershipId: context.membershipId,
        type: "follow_up_created",
        occurredAt,
        payload: {
          followUpId,
          ownerMembershipId,
          dueAt: input.followUpDueAt.toISOString(),
          note: input.followUpNote?.trim() || null,
          causedBy: "contact",
        },
      });
    }
    const contactTimelineEventId = await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId,
      actorMembershipId: context.membershipId,
      type: "contact",
      occurredAt,
      payload: {
        channel: input.channel.trim(),
        outcome: input.outcome.trim(),
        summary: input.summary?.trim() || null,
        followUpId,
      },
    });
    const evaluation = evaluateTreatmentGovernance(effectiveGovernance.rule, {
      hasNote: Boolean(input.summary?.trim()),
      hasFollowUp: Boolean(followUpId),
      hasEvidence: false,
    });
    await tx.insert(leadTreatmentGovernance).values({
      partnerId: context.partnerId,
      leadId,
      timelineEventId: contactTimelineEventId,
      ruleSource: effectiveGovernance.source,
      appliedRuleJson: effectiveGovernance.rule,
      ...evaluation,
      completedAt: evaluation.isComplete ? new Date() : null,
    });
    return {
      timelineEventId: contactTimelineEventId,
      governance: {
        source: effectiveGovernance.source,
        ...evaluation,
      },
    };
  });
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
