import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  min,
  or,
} from "drizzle-orm";
import {
  campaigns,
  followUps,
  leadTimelineEvents,
  leads,
  partnerSettings,
  pdvs,
  userPartners,
  userPdvAssignments,
  users,
} from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import { partnerDayBounds } from "./partnerTime";
import {
  campaignAllowsNewFollowUp,
  derivedFollowUpStatus,
} from "./followUpPolicy";

type FollowView = "overdue" | "today" | "upcoming" | "completed";

async function scopedPdvs(db: V2Database, context: PartnerContext) {
  if (context.role === "super_admin" || context.role === "partner_admin")
    return null;
  return (
    await db
      .select({ pdvId: userPdvAssignments.pdvId })
      .from(userPdvAssignments)
      .where(
        and(
          eq(userPdvAssignments.partnerId, context.partnerId),
          eq(userPdvAssignments.membershipId, context.membershipId!),
          eq(userPdvAssignments.isActive, true)
        )
      )
  ).map(row => row.pdvId);
}

async function loadLead(
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
  const scope = await scopedPdvs(db, context);
  if (scope && !scope.includes(lead.pdvId))
    throw new Error("Lead não encontrado");
  if (
    context.role === "seller" &&
    lead.assignedMembershipId !== context.membershipId
  )
    throw new Error("Lead não encontrado");
  return lead;
}

async function assertLeadOpenForNewFollowUp(
  db: V2Database,
  context: PartnerContext,
  leadId: number
) {
  const lead = await loadLead(db, context, leadId);
  const campaign = (
    await db
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
  if (
    !campaign ||
    !campaignAllowsNewFollowUp(campaign.status, campaign.isFrozen)
  )
    throw new Error("A campanha não permite criar ou reagendar follow-ups");
  return lead;
}

async function assertOwnerEligible(
  db: V2Database,
  context: PartnerContext,
  membershipId: number,
  pdvId: number
) {
  const owner = (
    await db
      .select({ id: userPartners.id })
      .from(userPartners)
      .innerJoin(users, eq(users.id, userPartners.userId))
      .where(
        and(
          eq(userPartners.id, membershipId),
          eq(userPartners.partnerId, context.partnerId),
          eq(userPartners.isActive, true),
          eq(users.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!owner) throw new Error("Responsável inválido para o parceiro atual");
  const assignment = (
    await db
      .select({ id: userPdvAssignments.id })
      .from(userPdvAssignments)
      .where(
        and(
          eq(userPdvAssignments.partnerId, context.partnerId),
          eq(userPdvAssignments.membershipId, membershipId),
          eq(userPdvAssignments.pdvId, pdvId),
          eq(userPdvAssignments.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!assignment)
    throw new Error("O responsável não possui acesso ao PDV do lead");
}

async function writeFollowTimeline(
  db: V2Database,
  input: {
    partnerId: number;
    leadId: number;
    actorMembershipId: number | null;
    type:
      | "follow_up_created"
      | "follow_up_completed"
      | "follow_up_cancelled"
      | "follow_up_rescheduled";
    payload: Record<string, unknown>;
    occurredAt?: Date;
  }
) {
  await db.insert(leadTimelineEvents).values({
    partnerId: input.partnerId,
    leadId: input.leadId,
    actorMembershipId: input.actorMembershipId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date(),
    payloadJson: input.payload,
    visibility: "partner",
  });
}

async function recalculateNextFollowUp(
  db: V2Database,
  partnerId: number,
  leadId: number
) {
  const row = (
    await db
      .select({ dueAt: min(followUps.dueAt) })
      .from(followUps)
      .where(
        and(
          eq(followUps.partnerId, partnerId),
          eq(followUps.leadId, leadId),
          eq(followUps.status, "pending")
        )
      )
  )[0];
  await db
    .update(leads)
    .set({ nextFollowUpAt: row?.dueAt ?? null, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.partnerId, partnerId)));
}

export async function createFollowUp(
  context: PartnerContext,
  input: {
    leadId: number;
    dueAt: Date;
    note?: string | null;
    ownerMembershipId?: number;
  }
) {
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const lead = await assertLeadOpenForNewFollowUp(
      transactionDb,
      context,
      input.leadId
    );
    const ownerMembershipId = input.ownerMembershipId ?? context.membershipId;
    if (!ownerMembershipId)
      throw new Error("Responsável do follow-up obrigatório");
    if (context.role === "seller" && ownerMembershipId !== context.membershipId)
      throw new Error("Vendedor só pode criar follow-up para si mesmo");
    if (
      context.role === "manager" ||
      context.role === "partner_admin" ||
      context.role === "super_admin"
    )
      await assertOwnerEligible(
        transactionDb,
        context,
        ownerMembershipId,
        lead.pdvId
      );
    if (input.dueAt.getTime() <= Date.now())
      throw new Error("O follow-up deve ser agendado para uma data futura");
    const inserted = await tx.insert(followUps).values({
      partnerId: context.partnerId,
      leadId: lead.id,
      ownerMembershipId,
      dueAt: input.dueAt,
      note: input.note?.trim() || null,
    });
    const followUpId = Number(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId
    );
    if (!followUpId) throw new Error("Não foi possível criar o follow-up");
    await recalculateNextFollowUp(transactionDb, context.partnerId, lead.id);
    await writeFollowTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId: lead.id,
      actorMembershipId: context.membershipId,
      type: "follow_up_created",
      payload: {
        followUpId,
        ownerMembershipId,
        dueAt: input.dueAt.toISOString(),
        note: input.note?.trim() || null,
      },
    });
    return followUpId;
  });
}

async function loadFollowUp(
  db: V2Database,
  context: PartnerContext,
  id: number
) {
  const followUp = (
    await db
      .select()
      .from(followUps)
      .where(
        and(eq(followUps.id, id), eq(followUps.partnerId, context.partnerId))
      )
      .limit(1)
  )[0];
  if (!followUp) throw new Error("Follow-up não encontrado");
  const lead = await loadLead(db, context, followUp.leadId);
  if (
    context.role === "seller" &&
    followUp.ownerMembershipId !== context.membershipId
  )
    throw new Error("Follow-up não encontrado");
  return { followUp, lead };
}

async function conditionalTransition(
  db: V2Database,
  context: PartnerContext,
  id: number,
  to: "completed" | "cancelled"
) {
  const { followUp, lead } = await loadFollowUp(db, context, id);
  if (followUp.status === to) return { followUp, lead, idempotent: true };
  if (followUp.status !== "pending")
    throw new Error("Transição de follow-up inválida");
  const now = new Date();
  const result = await db
    .update(followUps)
    .set({
      status: to,
      completedAt: to === "completed" ? now : null,
      cancelledAt: to === "cancelled" ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(followUps.id, id),
        eq(followUps.partnerId, context.partnerId),
        eq(followUps.status, "pending")
      )
    );
  const affected = Number(
    (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
  );
  if (affected !== 1) {
    const current = (
      await db
        .select({ status: followUps.status })
        .from(followUps)
        .where(
          and(eq(followUps.id, id), eq(followUps.partnerId, context.partnerId))
        )
        .limit(1)
    )[0];
    if (current?.status === to) return { followUp, lead, idempotent: true };
    throw new Error("Este follow-up já foi atualizado por outro usuário");
  }
  return { followUp, lead, idempotent: false };
}

export async function completeFollowUp(context: PartnerContext, id: number) {
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const result = await conditionalTransition(
      transactionDb,
      context,
      id,
      "completed"
    );
    if (!result.idempotent) {
      await recalculateNextFollowUp(
        transactionDb,
        context.partnerId,
        result.lead.id
      );
      await writeFollowTimeline(transactionDb, {
        partnerId: context.partnerId,
        leadId: result.lead.id,
        actorMembershipId: context.membershipId,
        type: "follow_up_completed",
        payload: { followUpId: id, dueAt: result.followUp.dueAt.toISOString() },
      });
    }
    return { idempotent: result.idempotent };
  });
}

export async function cancelFollowUp(context: PartnerContext, id: number) {
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const result = await conditionalTransition(
      transactionDb,
      context,
      id,
      "cancelled"
    );
    if (!result.idempotent) {
      await recalculateNextFollowUp(
        transactionDb,
        context.partnerId,
        result.lead.id
      );
      await writeFollowTimeline(transactionDb, {
        partnerId: context.partnerId,
        leadId: result.lead.id,
        actorMembershipId: context.membershipId,
        type: "follow_up_cancelled",
        payload: { followUpId: id, dueAt: result.followUp.dueAt.toISOString() },
      });
    }
    return { idempotent: result.idempotent };
  });
}

export async function rescheduleFollowUp(
  context: PartnerContext,
  id: number,
  input: { dueAt: Date; note?: string | null; reason?: string | null }
) {
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const { followUp, lead } = await loadFollowUp(transactionDb, context, id);
    if (followUp.status !== "pending")
      throw new Error("Somente follow-up pendente pode ser reagendado");
    await assertLeadOpenForNewFollowUp(transactionDb, context, lead.id);
    if (input.dueAt.getTime() <= Date.now())
      throw new Error("O novo horário deve estar no futuro");
    const now = new Date();
    const result = await tx
      .update(followUps)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(followUps.id, id),
          eq(followUps.partnerId, context.partnerId),
          eq(followUps.status, "pending")
        )
      );
    const affected = Number(
      (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
    );
    if (affected !== 1)
      throw new Error("Este follow-up já foi atualizado por outro usuário");
    const inserted = await tx.insert(followUps).values({
      partnerId: context.partnerId,
      leadId: lead.id,
      ownerMembershipId: followUp.ownerMembershipId,
      rescheduledFromId: followUp.id,
      dueAt: input.dueAt,
      note: input.note?.trim() || followUp.note,
    });
    const newFollowUpId = Number(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId
    );
    await recalculateNextFollowUp(transactionDb, context.partnerId, lead.id);
    await writeFollowTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId: lead.id,
      actorMembershipId: context.membershipId,
      type: "follow_up_rescheduled",
      payload: {
        previousFollowUpId: id,
        followUpId: newFollowUpId,
        previousDueAt: followUp.dueAt.toISOString(),
        dueAt: input.dueAt.toISOString(),
        reason: input.reason?.trim() || null,
      },
    });
    return newFollowUpId;
  });
}

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

export async function listFollowUps(
  context: PartnerContext,
  input: {
    view: FollowView;
    page: number;
    pageSize: number;
    ownerMembershipId?: number;
    pdvId?: number;
  }
) {
  const db = await getV2Db();
  const timezone = await partnerTimezone(db, context.partnerId);
  const now = new Date();
  const bounds = partnerDayBounds(timezone, now);
  const scope = await scopedPdvs(db, context);
  if (scope && !scope.length)
    return {
      items: [],
      total: 0,
      page: input.page,
      pageSize: input.pageSize,
      timezone,
    };
  const conditions = [
    eq(followUps.partnerId, context.partnerId),
    isNull(leads.deletedAt),
  ];
  if (scope) conditions.push(inArray(leads.pdvId, scope));
  if (context.role === "seller")
    conditions.push(eq(followUps.ownerMembershipId, context.membershipId!));
  if (input.ownerMembershipId && context.role !== "seller")
    conditions.push(eq(followUps.ownerMembershipId, input.ownerMembershipId));
  if (input.pdvId) conditions.push(eq(leads.pdvId, input.pdvId));
  if (input.view === "overdue")
    conditions.push(eq(followUps.status, "pending"), lt(followUps.dueAt, now));
  if (input.view === "today")
    conditions.push(
      eq(followUps.status, "pending"),
      gte(followUps.dueAt, now),
      lt(followUps.dueAt, bounds.end)
    );
  if (input.view === "upcoming")
    conditions.push(
      eq(followUps.status, "pending"),
      gte(followUps.dueAt, bounds.end)
    );
  if (input.view === "completed")
    conditions.push(
      or(eq(followUps.status, "completed"), eq(followUps.status, "cancelled"))!
    );
  const where = and(...conditions);
  const pageSize = Math.min(Math.max(input.pageSize, 1), 100);
  const fields = {
    id: followUps.id,
    leadId: followUps.leadId,
    ownerMembershipId: followUps.ownerMembershipId,
    dueAt: followUps.dueAt,
    status: followUps.status,
    note: followUps.note,
    completedAt: followUps.completedAt,
    cancelledAt: followUps.cancelledAt,
    leadName: leads.name,
    leadPhone: leads.phone,
    pdvId: leads.pdvId,
    pdvName: pdvs.name,
    campaignName: campaigns.name,
  };
  const [items, totals] = await Promise.all([
    db
      .select(fields)
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
      .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .where(where)
      .orderBy(asc(followUps.dueAt), asc(followUps.id))
      .limit(pageSize)
      .offset((Math.max(input.page, 1) - 1) * pageSize),
    db
      .select({ total: count() })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .where(where),
  ]);
  return {
    items: items.map(item => ({
      ...item,
      derivedStatus: derivedFollowUpStatus(item.status, item.dueAt, now),
    })),
    total: Number(totals[0]?.total ?? 0),
    page: Math.max(input.page, 1),
    pageSize,
    timezone,
  };
}

export async function followUpAlerts(context: PartnerContext) {
  const db = await getV2Db();
  const timezone = await partnerTimezone(db, context.partnerId);
  const now = new Date();
  const bounds = partnerDayBounds(timezone, now);
  const scope = await scopedPdvs(db, context);
  if (scope && !scope.length)
    return { overdue: 0, today: 0, nextDueAt: null, timezone };
  const base = [
    eq(followUps.partnerId, context.partnerId),
    eq(followUps.status, "pending"),
    isNull(leads.deletedAt),
  ];
  if (scope) base.push(inArray(leads.pdvId, scope));
  if (context.role === "seller")
    base.push(eq(followUps.ownerMembershipId, context.membershipId!));
  const [overdue, today, next] = await Promise.all([
    db
      .select({ total: count() })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .where(and(...base, lt(followUps.dueAt, now))),
    db
      .select({ total: count() })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .where(
        and(...base, gte(followUps.dueAt, now), lt(followUps.dueAt, bounds.end))
      ),
    db
      .select({ dueAt: min(followUps.dueAt) })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .where(and(...base)),
  ]);
  return {
    overdue: Number(overdue[0]?.total ?? 0),
    today: Number(today[0]?.total ?? 0),
    nextDueAt: next[0]?.dueAt ?? null,
    timezone,
  };
}
