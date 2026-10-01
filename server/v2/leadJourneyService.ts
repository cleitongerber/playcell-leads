import { and, asc, desc, eq, inArray, isNull, min, sql } from "drizzle-orm";
import {
  campaignPdvs,
  campaigns,
  followUps,
  leadContactAttempts,
  leadContacts,
  leadConversions,
  leadEvidences,
  leadInteractionResults,
  leadOperationCommands,
  leadStatuses,
  leadTimelineEvents,
  leadTreatmentGovernance,
  leads,
  partnerSettings,
  userPartners,
  userPdvAssignments,
  users,
  type LeadInteractionKind,
  type LeadTimelineType,
} from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import {
  assertAttemptGovernance,
  assertContactGovernance,
  evaluateAttemptGovernance,
  evaluateTreatmentGovernance,
  resolveGovernanceForAttempt,
  resolveGovernanceForContact,
  type AttemptGovernanceRule,
  type GovernanceRule,
} from "./governancePolicy";
import {
  resolveEffectiveAttemptGovernance,
  resolveEffectiveGovernance,
} from "./governanceService";
import { deriveNextLeadAction, type NextLeadAction } from "./leadJourneyDomain";
import {
  commandReplayDisposition,
  assertOperationRequestKey,
} from "./leadOperationCommandPolicy";
import { assertConversionSource } from "./leadConversionPolicy";
import { assertInteractionResultKind } from "./interactionResultPolicy";
import {
  LeadJourneyOperationError,
  assertAdministrativeStatusRole,
  assertAdministrativeStatusTransition,
  assertConversionStatus,
  assertFollowUpApplicability,
  assertLeadAcceptsCommercialOperation,
  assertReopenRole,
  isFollowUpRequired,
  requiresAdministrativeStatusReason,
  resolveEffectiveContactFinalStatus,
} from "./leadJourneyOperationalPolicy";
import {
  campaignAllowsLeadOperations,
  sellerCanModifyLead,
} from "./leadPolicy";
import {
  listPartnerInteractionResults,
  listPartnerLeadStatuses,
} from "./leadConfiguration";
import { writeV2Audit } from "./partnerService";
import {
  evidenceAuditMetadata,
  preparePrivateEvidence,
  type PreparedPrivateEvidence,
} from "./evidenceService";

type LeadRow = typeof leads.$inferSelect;
type LeadStatusRow = typeof leadStatuses.$inferSelect;
type InteractionResultRow = typeof leadInteractionResults.$inferSelect;

type FollowUpInput = {
  dueAt: Date;
  note?: string | null;
};

type EvidenceInput = {
  fileName: string;
  mimeType: string;
  base64: string;
};

type CommandOperation =
  | "register_attempt"
  | "record_effective_contact"
  | "change_administrative_status"
  | "reopen_lead";

type PendingRequirement = {
  kind: "note" | "follow_up" | "evidence";
  timelineEventId: number;
};

type OperationalTimelineEvent = {
  id: number;
  type: LeadTimelineType;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export type RegisterAttemptInput = {
  leadId: number;
  channel: string;
  resultId: number;
  summary?: string | null;
  occurredAt?: Date;
  followUp?: FollowUpInput | null;
  evidence?: EvidenceInput | null;
  requestKey: string;
};

export type RecordEffectiveContactInput = {
  leadId: number;
  channel: string;
  resultId: number;
  summary?: string | null;
  finalStatusId?: number | null;
  followUp?: FollowUpInput | null;
  occurredAt?: Date;
  expectedStatusId?: number | null;
  requestKey: string;
};

export type ChangeAdministrativeStatusInput = {
  leadId: number;
  statusId: number;
  reason?: string | null;
  expectedStatusId?: number | null;
  requestKey: string;
};

export type ReopenLeadInput = {
  leadId: number;
  statusId: number;
  reason: string;
  expectedStatusId: number;
  requestKey: string;
};

export type LeadOperationRequirementsInput = {
  leadId: number;
  operationKind: "attempt" | "effective_contact";
  channel?: string;
  resultId?: number;
};

function insertedId(result: unknown, message: string) {
  const id = Number(
    (result as [{ insertId?: number }] | undefined)?.[0]?.insertId
  );
  if (!id) throw new Error(message);
  return id;
}

function affectedRows(result: unknown) {
  return Number(
    (result as [{ affectedRows?: number }] | undefined)?.[0]?.affectedRows ?? 0
  );
}

function normalizedText(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizedChannel(value: string) {
  const channel = value.trim();
  if (!channel) throw new Error("Canal obrigatório");
  return channel;
}

function normalizedReason(value: string | null | undefined) {
  return value?.trim() || null;
}

async function scopedPdvIds(db: V2Database, context: PartnerContext) {
  if (context.role === "super_admin" || context.role === "partner_admin") {
    return null;
  }
  if (!context.membershipId) return [];
  const assignments = await db
    .select({ pdvId: userPdvAssignments.pdvId })
    .from(userPdvAssignments)
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId),
        eq(userPdvAssignments.isActive, true)
      )
    );
  return assignments.map(row => row.pdvId);
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
  return lead;
}

async function assertLeadScope(
  db: V2Database,
  context: PartnerContext,
  lead: LeadRow,
  mode: "operational" | "administrative" | "read"
) {
  const scope = await scopedPdvIds(db, context);
  if (scope && !scope.includes(lead.pdvId))
    throw new Error("Lead não encontrado");
  if (context.role === "seller") {
    if (
      mode === "operational" &&
      !sellerCanModifyLead(lead.assignedMembershipId, context.membershipId)
    ) {
      throw new Error("Somente o responsável pode operar este lead");
    }
    if (
      mode === "read" &&
      lead.assignedMembershipId !== null &&
      lead.assignedMembershipId !== context.membershipId
    ) {
      throw new Error("Lead não encontrado");
    }
  }
}

async function assertCampaignOperational(
  db: V2Database,
  context: PartnerContext,
  lead: LeadRow
) {
  const campaign = (
    await db
      .select()
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
    !campaignAllowsLeadOperations(campaign.status, campaign.isFrozen)
  ) {
    throw new Error("A campanha não permite operações de lead neste momento");
  }
  const relation = (
    await db
      .select({ id: campaignPdvs.id })
      .from(campaignPdvs)
      .where(
        and(
          eq(campaignPdvs.partnerId, context.partnerId),
          eq(campaignPdvs.campaignId, lead.campaignId),
          eq(campaignPdvs.pdvId, lead.pdvId),
          eq(campaignPdvs.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!relation) throw new Error("O PDV não participa da campanha");
  return campaign;
}

async function assertLeadOpenForCommercialOperation(
  db: V2Database,
  context: PartnerContext,
  lead: LeadRow
) {
  const status = await getCurrentStatus(db, context.partnerId, lead.statusId);
  assertLeadAcceptsCommercialOperation(status.isTerminal);
  return status;
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
  if (!status) throw new Error("Situação inválida para o parceiro atual");
  return status;
}

async function getCurrentStatus(
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
          eq(leadStatuses.partnerId, partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!status) throw new Error("Situação atual do lead não está disponível");
  return status;
}

async function getActiveResult(
  db: V2Database,
  context: PartnerContext,
  resultId: number,
  kind: LeadInteractionKind
) {
  const result = (
    await db
      .select()
      .from(leadInteractionResults)
      .where(
        and(
          eq(leadInteractionResults.id, resultId),
          eq(leadInteractionResults.partnerId, context.partnerId),
          eq(leadInteractionResults.interactionKind, kind),
          eq(leadInteractionResults.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!result) throw new Error("Resultado indisponível para esta operação");
  assertInteractionResultKind(kind, result.interactionKind);
  return result;
}

async function assertOperationalMembership(context: PartnerContext) {
  if (!context.membershipId) {
    throw new Error(
      "Uma membership operacional ativa é necessária para registrar esta ação"
    );
  }
  return context.membershipId;
}

/**
 * Active choices for the unified operational form. Sellers receive labels and
 * policies for their permitted partner, never the ability to mutate the
 * catalogue.
 */
export async function listOperationalInteractionResults(
  context: PartnerContext,
  interactionKind: LeadInteractionKind
) {
  const db = await getV2Db();
  return listPartnerInteractionResults(db, context.partnerId, interactionKind);
}

/**
 * Read-only form contract for the separated journey. React consumes this
 * response to decide what to render; all state, governance and RBAC decisions
 * remain independently enforced again by the write commands.
 */
export async function getLeadOperationRequirements(
  context: PartnerContext,
  input: LeadOperationRequirementsInput
) {
  const db = await getV2Db();
  const lead = await loadLead(db, context, input.leadId);
  await assertLeadScope(db, context, lead, "read");

  const currentStatus = await getCurrentStatus(
    db,
    context.partnerId,
    lead.statusId
  );
  let campaignOperational = true;
  try {
    await assertCampaignOperational(db, context, lead);
  } catch {
    campaignOperational = false;
  }

  const operationalMembership = Boolean(context.membershipId);
  const sellerOwnsLead =
    context.role !== "seller" ||
    sellerCanModifyLead(lead.assignedMembershipId, context.membershipId);
  const canOperate =
    operationalMembership &&
    sellerOwnsLead &&
    campaignOperational &&
    !currentStatus.isTerminal;

  const rawChannel = input.channel?.trim() || null;
  let rule: GovernanceRule | AttemptGovernanceRule;
  let governanceFollowUpRequired = false;
  if (input.operationKind === "attempt") {
    const effective = await resolveEffectiveAttemptGovernance(
      db,
      context.partnerId,
      lead.campaignId
    );
    rule = rawChannel
      ? resolveGovernanceForAttempt(effective.rule, rawChannel)
      : effective.rule;
  } else {
    const effective = await resolveEffectiveGovernance(
      db,
      context.partnerId,
      lead.campaignId
    );
    const contactRule = rawChannel
      ? resolveGovernanceForContact(effective.rule, rawChannel)
      : effective.rule;
    rule = contactRule;
    governanceFollowUpRequired = contactRule.followUpRequired;
  }
  const result = input.resultId
    ? await getActiveResult(db, context, input.resultId, input.operationKind)
    : null;

  let suggestedStatus: LeadStatusRow | null = null;
  if (
    input.operationKind === "effective_contact" &&
    result?.suggestedStatusId
  ) {
    suggestedStatus = await getActiveStatus(
      db,
      context.partnerId,
      result.suggestedStatusId
    );
  }
  if (
    input.operationKind === "effective_contact" &&
    result &&
    result.statusPolicy !== "none" &&
    !suggestedStatus
  ) {
    throw new LeadJourneyOperationError(
      "INVALID_RESULT_CONFIGURATION",
      "Resultado configurado sem situação sugerida"
    );
  }

  const followUpRequired =
    input.operationKind === "effective_contact" && result
      ? isFollowUpRequired({
          governanceRequiresFollowUp: governanceFollowUpRequired,
          resultPolicy: result.followUpPolicy,
        })
      : input.operationKind === "effective_contact"
        ? governanceFollowUpRequired
        : false;
  const followUpAllowed =
    input.operationKind === "attempt"
      ? result?.followUpPolicy !== "not_applicable"
      : Boolean(
          followUpRequired || result?.followUpPolicy !== "not_applicable"
        );
  const canOverrideSuggestedStatus = Boolean(
    input.operationKind === "effective_contact" &&
      result?.statusPolicy === "suggest" &&
      (context.role !== "seller" || result.allowSellerOverride)
  );

  return {
    operationKind: input.operationKind,
    canOperate,
    campaignOperational,
    isTerminal: currentStatus.isTerminal,
    blockedReason: !operationalMembership
      ? "Uma membership operacional ativa é necessária para registrar esta ação"
      : !sellerOwnsLead
        ? "Somente o responsável pode operar este lead"
        : !campaignOperational
          ? "A campanha não permite operações de lead neste momento"
          : currentStatus.isTerminal
            ? "Reabra o lead antes de registrar uma nova ação comercial"
            : null,
    allowedChannels: rule.allowedChannels,
    requirements: {
      summaryRequired: rule.noteRequired,
      evidenceRequired: rule.evidenceRequired,
      followUp: {
        required: followUpRequired,
        allowed: followUpAllowed,
      },
    },
    result: result
      ? {
          id: result.id,
          code: result.code,
          label: result.label,
          category: result.category,
          followUpPolicy: result.followUpPolicy,
          conversionMode: result.conversionMode,
        }
      : null,
    status: {
      policy:
        input.operationKind === "effective_contact"
          ? (result?.statusPolicy ?? "none")
          : "none",
      suggested: suggestedStatus
        ? {
            id: suggestedStatus.id,
            label: suggestedStatus.label,
            category: suggestedStatus.category,
            isTerminal: suggestedStatus.isTerminal,
          }
        : null,
      canOverrideSuggestedStatus,
    },
    statuses: await listPartnerLeadStatuses(db, context.partnerId),
  };
}

async function writeTimeline(
  db: V2Database,
  input: {
    partnerId: number;
    leadId: number;
    actorMembershipId: number | null;
    type: LeadTimelineType;
    occurredAt?: Date;
    payload: Record<string, unknown>;
  }
) {
  const inserted = await db.insert(leadTimelineEvents).values({
    partnerId: input.partnerId,
    leadId: input.leadId,
    actorMembershipId: input.actorMembershipId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date(),
    payloadJson: input.payload,
    visibility: "partner",
  });
  return insertedId(inserted, "Não foi possível registrar a timeline");
}

async function assertFollowUpOwner(
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
          eq(userPartners.partnerId, context.partnerId),
          eq(userPartners.isActive, true),
          eq(users.isActive, true),
          eq(userPdvAssignments.pdvId, pdvId),
          eq(userPdvAssignments.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!owner) {
    throw new Error("O responsável não possui acesso ativo ao PDV do lead");
  }
}

async function createProvisionalFollowUp(
  db: V2Database,
  context: PartnerContext,
  lead: LeadRow,
  input: FollowUpInput
) {
  if (input.dueAt.getTime() <= Date.now()) {
    throw new Error(
      "O próximo follow-up deve ser agendado para uma data futura"
    );
  }
  const ownerMembershipId = lead.assignedMembershipId ?? context.membershipId;
  if (!ownerMembershipId)
    throw new Error("Responsável do follow-up obrigatório");
  await assertFollowUpOwner(db, context, ownerMembershipId, lead.pdvId);
  const inserted = await db.insert(followUps).values({
    partnerId: context.partnerId,
    leadId: lead.id,
    ownerMembershipId,
    dueAt: input.dueAt,
    note: normalizedText(input.note),
  });
  return {
    id: insertedId(inserted, "Não foi possível criar o follow-up"),
    ownerMembershipId,
    dueAt: input.dueAt,
    note: normalizedText(input.note),
  };
}

async function bindFollowUpToOrigin(
  db: V2Database,
  context: PartnerContext,
  leadId: number,
  followUpId: number,
  timelineEventId: number
) {
  const result = await db
    .update(followUps)
    .set({ originTimelineEventId: timelineEventId, updatedAt: new Date() })
    .where(
      and(
        eq(followUps.id, followUpId),
        eq(followUps.partnerId, context.partnerId),
        eq(followUps.leadId, leadId),
        isNull(followUps.originTimelineEventId)
      )
    );
  if (affectedRows(result) !== 1) {
    throw new Error("Não foi possível vincular a origem do follow-up");
  }
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
    .where(and(eq(leads.partnerId, partnerId), eq(leads.id, leadId)));
}

async function writeAttemptGovernance(
  db: V2Database,
  input: {
    context: PartnerContext;
    leadId: number;
    timelineEventId: number;
    source: "partner" | "campaign";
    rule: AttemptGovernanceRule;
    hasNote: boolean;
    hasEvidence: boolean;
  }
) {
  const state = evaluateAttemptGovernance(input.rule, {
    hasNote: input.hasNote,
    hasEvidence: input.hasEvidence,
  });
  await db.insert(leadTreatmentGovernance).values({
    partnerId: input.context.partnerId,
    leadId: input.leadId,
    timelineEventId: input.timelineEventId,
    operationKind: "attempt",
    ruleSource: input.source,
    appliedRuleJson: input.rule,
    noteSatisfied: state.noteSatisfied,
    followUpSatisfied: true,
    evidenceSatisfied: state.evidenceSatisfied,
    isComplete: state.isComplete,
    completedAt: state.isComplete ? new Date() : null,
  });
  return state;
}

async function writeEffectiveContactGovernance(
  db: V2Database,
  input: {
    context: PartnerContext;
    leadId: number;
    timelineEventId: number;
    source: "partner" | "campaign";
    rule: GovernanceRule;
    hasNote: boolean;
    hasFollowUp: boolean;
  }
) {
  const state = evaluateTreatmentGovernance(input.rule, {
    hasNote: input.hasNote,
    hasFollowUp: input.hasFollowUp,
    hasEvidence: false,
  });
  await db.insert(leadTreatmentGovernance).values({
    partnerId: input.context.partnerId,
    leadId: input.leadId,
    timelineEventId: input.timelineEventId,
    operationKind: "effective_contact",
    ruleSource: input.source,
    appliedRuleJson: input.rule,
    noteSatisfied: state.noteSatisfied,
    followUpSatisfied: state.followUpSatisfied,
    evidenceSatisfied: state.evidenceSatisfied,
    isComplete: state.isComplete,
    completedAt: state.isComplete ? new Date() : null,
  });
  return state;
}

function requirementsFromGovernance(
  governance: {
    timelineEventId: number;
    noteSatisfied: boolean;
    followUpSatisfied: boolean;
    evidenceSatisfied: boolean;
  } | null
) {
  if (!governance) return [] as PendingRequirement[];
  const pending: PendingRequirement[] = [];
  if (!governance.noteSatisfied)
    pending.push({ kind: "note", timelineEventId: governance.timelineEventId });
  if (!governance.followUpSatisfied)
    pending.push({
      kind: "follow_up",
      timelineEventId: governance.timelineEventId,
    });
  if (!governance.evidenceSatisfied)
    pending.push({
      kind: "evidence",
      timelineEventId: governance.timelineEventId,
    });
  return pending;
}

async function deriveOperationalNextAction(
  db: V2Database,
  partnerId: number,
  leadId: number
): Promise<NextLeadAction> {
  const lead = (
    await db
      .select()
      .from(leads)
      .where(and(eq(leads.partnerId, partnerId), eq(leads.id, leadId)))
      .limit(1)
  )[0];
  if (!lead) throw new Error("Lead não encontrado");
  const [
    status,
    campaign,
    settings,
    pendingGovernance,
    pendingFollowUps,
    attempts,
    contact,
  ] = await Promise.all([
    getCurrentStatus(db, partnerId, lead.statusId),
    db
      .select({ status: campaigns.status, isFrozen: campaigns.isFrozen })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.partnerId, partnerId),
          eq(campaigns.id, lead.campaignId)
        )
      )
      .limit(1),
    db
      .select({ timezone: partnerSettings.timezone })
      .from(partnerSettings)
      .where(eq(partnerSettings.partnerId, partnerId))
      .limit(1),
    db
      .select({ id: leadTreatmentGovernance.id })
      .from(leadTreatmentGovernance)
      .where(
        and(
          eq(leadTreatmentGovernance.partnerId, partnerId),
          eq(leadTreatmentGovernance.leadId, leadId),
          eq(leadTreatmentGovernance.isComplete, false)
        )
      )
      .limit(1),
    db
      .select({ dueAt: followUps.dueAt })
      .from(followUps)
      .where(
        and(
          eq(followUps.partnerId, partnerId),
          eq(followUps.leadId, leadId),
          eq(followUps.status, "pending")
        )
      )
      .orderBy(asc(followUps.dueAt)),
    db
      .select({
        category: leadContactAttempts.resultCategory,
        occurredAt: leadContactAttempts.occurredAt,
      })
      .from(leadContactAttempts)
      .where(
        and(
          eq(leadContactAttempts.partnerId, partnerId),
          eq(leadContactAttempts.leadId, leadId)
        )
      )
      .orderBy(
        desc(leadContactAttempts.occurredAt),
        desc(leadContactAttempts.id)
      ),
    db
      .select({ id: leadContacts.id })
      .from(leadContacts)
      .where(
        and(
          eq(leadContacts.partnerId, partnerId),
          eq(leadContacts.leadId, leadId),
          eq(leadContacts.recordKind, "effective_contact")
        )
      )
      .limit(1),
  ]);
  const campaignRow = campaign[0];
  return deriveNextLeadAction({
    timeZone: settings[0]?.timezone ?? "America/Sao_Paulo",
    hasBlockingGovernance: Boolean(pendingGovernance[0]),
    isCampaignOperational: Boolean(
      campaignRow &&
        campaignAllowsLeadOperations(campaignRow.status, campaignRow.isFrozen)
    ),
    isTerminal: status.isTerminal,
    pendingFollowUps,
    attempts,
    hasEffectiveContact: Boolean(contact[0]),
  });
}

async function startCommand(
  db: V2Database,
  context: PartnerContext,
  operationType: CommandOperation,
  requestKey: string
) {
  const normalizedKey = assertOperationRequestKey(requestKey);
  const find = async () =>
    (
      await db
        .select()
        .from(leadOperationCommands)
        .where(
          and(
            eq(leadOperationCommands.partnerId, context.partnerId),
            eq(leadOperationCommands.actorUserId, context.userId),
            eq(leadOperationCommands.operationType, operationType),
            eq(leadOperationCommands.requestKey, normalizedKey)
          )
        )
        .limit(1)
    )[0];
  const existing = await find();
  if (existing) return { existing, requestKey: normalizedKey };
  try {
    await db.insert(leadOperationCommands).values({
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      operationType,
      requestKey: normalizedKey,
      status: "processing",
    });
  } catch (error) {
    const raced = await find();
    if (raced) return { existing: raced, requestKey: normalizedKey };
    throw error;
  }
  return { existing: null, requestKey: normalizedKey };
}

async function completeCommand(
  db: V2Database,
  context: PartnerContext,
  operationType: CommandOperation,
  requestKey: string,
  timelineEventId: number
) {
  await db
    .update(leadOperationCommands)
    .set({
      status: "completed",
      resultReferenceType: "timeline_event",
      resultReferenceId: String(timelineEventId),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(leadOperationCommands.partnerId, context.partnerId),
        eq(leadOperationCommands.actorUserId, context.userId),
        eq(leadOperationCommands.operationType, operationType),
        eq(leadOperationCommands.requestKey, requestKey),
        eq(leadOperationCommands.status, "processing")
      )
    );
}

async function replayCompletedCommand(
  db: V2Database,
  context: PartnerContext,
  command: typeof leadOperationCommands.$inferSelect
) {
  const disposition = commandReplayDisposition(command.status);
  if (disposition === "return_processing") {
    throw new LeadJourneyOperationError(
      "LEAD_OPERATION_IN_PROGRESS",
      "A operação ainda está sendo processada"
    );
  }
  if (disposition === "return_failed") {
    throw new Error(
      "A operação anterior falhou; use uma nova chave de idempotência"
    );
  }
  const timelineEventId = Number(command.resultReferenceId);
  if (!timelineEventId || command.resultReferenceType !== "timeline_event") {
    throw new Error("Comando concluído sem referência operacional válida");
  }
  const timelineEvent = (
    await db
      .select()
      .from(leadTimelineEvents)
      .where(
        and(
          eq(leadTimelineEvents.partnerId, context.partnerId),
          eq(leadTimelineEvents.id, timelineEventId)
        )
      )
      .limit(1)
  )[0];
  if (!timelineEvent) throw new Error("Evento operacional não encontrado");
  const [lead, governance, followUp, contact] = await Promise.all([
    loadLead(db, context, timelineEvent.leadId),
    db
      .select()
      .from(leadTreatmentGovernance)
      .where(
        and(
          eq(leadTreatmentGovernance.partnerId, context.partnerId),
          eq(leadTreatmentGovernance.timelineEventId, timelineEventId)
        )
      )
      .limit(1),
    db
      .select()
      .from(followUps)
      .where(
        and(
          eq(followUps.partnerId, context.partnerId),
          eq(followUps.originTimelineEventId, timelineEventId)
        )
      )
      .limit(1),
    db
      .select()
      .from(leadContacts)
      .where(
        and(
          eq(leadContacts.partnerId, context.partnerId),
          eq(leadContacts.timelineEventId, timelineEventId)
        )
      )
      .limit(1),
  ]);
  await assertLeadScope(db, context, lead, "read");
  const conversion = contact[0]
    ? ((
        await db
          .select()
          .from(leadConversions)
          .where(
            and(
              eq(leadConversions.partnerId, context.partnerId),
              eq(leadConversions.effectiveContactId, contact[0].id)
            )
          )
          .limit(1)
      )[0] ?? null)
    : null;
  const nextAction = await deriveOperationalNextAction(
    db,
    context.partnerId,
    lead.id
  );
  return {
    operation: command.operationType,
    idempotent: true,
    lead,
    timelineEvent: {
      id: timelineEvent.id,
      type: timelineEvent.type,
      occurredAt: timelineEvent.occurredAt,
      payload:
        (timelineEvent.payloadJson as Record<string, unknown> | null) ?? {},
    },
    governance: governance[0] ?? null,
    followUp: followUp[0] ?? null,
    conversion,
    nextAction,
    pendingRequirements: requirementsFromGovernance(governance[0] ?? null),
  };
}

async function conditionalStatusUpdate(
  db: V2Database,
  input: {
    context: PartnerContext;
    lead: LeadRow;
    expectedStatusId?: number | null;
    statusId: number;
    occurredAt: Date;
    firstEffectiveContact?: boolean;
  }
) {
  const expectedStatusId = input.expectedStatusId ?? input.lead.statusId;
  if (expectedStatusId !== input.lead.statusId) {
    throw new LeadJourneyOperationError(
      "LEAD_STATUS_CONFLICT",
      "A situação do lead foi alterada por outro usuário"
    );
  }
  const result = await db
    .update(leads)
    .set({
      statusId: input.statusId,
      ...(input.firstEffectiveContact
        ? {
            firstEffectiveContactAt: sql`coalesce(${leads.firstEffectiveContactAt}, ${input.occurredAt})`,
          }
        : {}),
      lastActivityAt: input.occurredAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(leads.partnerId, input.context.partnerId),
        eq(leads.id, input.lead.id),
        eq(leads.statusId, expectedStatusId),
        isNull(leads.deletedAt)
      )
    );
  if (affectedRows(result) !== 1) {
    throw new LeadJourneyOperationError(
      "LEAD_STATUS_CONFLICT",
      "A situação do lead foi alterada por outro usuário"
    );
  }
}

async function updateAttemptActivity(
  db: V2Database,
  context: PartnerContext,
  lead: LeadRow,
  occurredAt: Date
) {
  await db
    .update(leads)
    .set({
      firstAttemptAt: sql`coalesce(${leads.firstAttemptAt}, ${occurredAt})`,
      lastActivityAt: occurredAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(leads.partnerId, context.partnerId),
        eq(leads.id, lead.id),
        isNull(leads.deletedAt)
      )
    );
}

async function updateEffectiveContactActivity(
  db: V2Database,
  context: PartnerContext,
  lead: LeadRow,
  occurredAt: Date
) {
  await db
    .update(leads)
    .set({
      firstEffectiveContactAt: sql`coalesce(${leads.firstEffectiveContactAt}, ${occurredAt})`,
      lastActivityAt: occurredAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(leads.partnerId, context.partnerId),
        eq(leads.id, lead.id),
        isNull(leads.deletedAt)
      )
    );
}

function operationResponse(input: {
  operation: CommandOperation;
  lead: LeadRow;
  timelineEvent: OperationalTimelineEvent;
  governance: {
    timelineEventId: number;
    noteSatisfied: boolean;
    followUpSatisfied: boolean;
    evidenceSatisfied: boolean;
    isComplete: boolean;
  } | null;
  followUp: Record<string, unknown> | null;
  conversion: Record<string, unknown> | null;
  nextAction: NextLeadAction;
}) {
  return {
    operation: input.operation,
    idempotent: false,
    lead: input.lead,
    timelineEvent: input.timelineEvent,
    governance: input.governance,
    followUp: input.followUp,
    conversion: input.conversion,
    nextAction: input.nextAction,
    pendingRequirements: requirementsFromGovernance(input.governance),
  };
}

export async function registerAttempt(
  context: PartnerContext,
  input: RegisterAttemptInput
) {
  const db = await getV2Db();
  const actorMembershipId = await assertOperationalMembership(context);
  const stagedEvidence: { value: PreparedPrivateEvidence | null } = {
    value: null,
  };
  try {
    const response = await db.transaction(async tx => {
      const transactionDb = tx as unknown as V2Database;
      const command = await startCommand(
        transactionDb,
        context,
        "register_attempt",
        input.requestKey
      );
      if (command.existing) {
        return replayCompletedCommand(transactionDb, context, command.existing);
      }

      const lead = await loadLead(transactionDb, context, input.leadId);
      await assertLeadScope(transactionDb, context, lead, "operational");
      await assertCampaignOperational(transactionDb, context, lead);
      await assertLeadOpenForCommercialOperation(transactionDb, context, lead);
      const channel = normalizedChannel(input.channel);
      const result = await getActiveResult(
        transactionDb,
        context,
        input.resultId,
        "attempt"
      );
      const effectiveGovernance = await resolveEffectiveAttemptGovernance(
        transactionDb,
        context.partnerId,
        lead.campaignId
      );
      const rule = resolveGovernanceForAttempt(
        effectiveGovernance.rule,
        channel
      );
      const summary = normalizedText(input.summary);
      assertAttemptGovernance(rule, { channel, summary });
      if (rule.evidenceRequired && !input.evidence) {
        throw new LeadJourneyOperationError(
          "EVIDENCE_REQUIRED",
          "Adicione a evidência obrigatória para registrar esta tentativa"
        );
      }
      if (input.evidence) {
        stagedEvidence.value = await preparePrivateEvidence(
          context.partnerId,
          input.evidence,
          rule
        );
      }
      const occurredAt = input.occurredAt ?? new Date();
      const governancePreview = evaluateAttemptGovernance(rule, {
        hasNote: Boolean(summary),
        hasEvidence: Boolean(stagedEvidence.value),
      });
      assertFollowUpApplicability({
        governanceRequiresFollowUp: false,
        resultPolicy: result.followUpPolicy,
        hasFollowUp: Boolean(input.followUp),
      });
      const followUp = input.followUp
        ? await createProvisionalFollowUp(
            transactionDb,
            context,
            lead,
            input.followUp
          )
        : null;
      const timelinePayload = {
        channel,
        resultCode: result.code,
        resultLabel: result.label,
        resultCategory: result.category,
        followUpId: followUp?.id ?? null,
        governance: {
          isComplete: governancePreview.isComplete,
          evidencePending: !governancePreview.evidenceSatisfied,
        },
      };
      const timelineEventId = await writeTimeline(transactionDb, {
        partnerId: context.partnerId,
        leadId: lead.id,
        actorMembershipId,
        type: "contact_attempted",
        occurredAt,
        payload: timelinePayload,
      });
      if (followUp) {
        await bindFollowUpToOrigin(
          transactionDb,
          context,
          lead.id,
          followUp.id,
          timelineEventId
        );
        await recalculateNextFollowUp(
          transactionDb,
          context.partnerId,
          lead.id
        );
      }
      const attemptInserted = await tx.insert(leadContactAttempts).values({
        partnerId: context.partnerId,
        leadId: lead.id,
        actorMembershipId,
        timelineEventId,
        channel,
        resultId: result.id,
        resultCode: result.code,
        resultLabel: result.label,
        resultCategory: result.category,
        summary,
        occurredAt,
      });
      const attemptId = insertedId(
        attemptInserted,
        "Não foi possível registrar a tentativa"
      );
      await updateAttemptActivity(transactionDb, context, lead, occurredAt);
      const governanceState = await writeAttemptGovernance(transactionDb, {
        context,
        leadId: lead.id,
        timelineEventId,
        source: effectiveGovernance.source,
        rule,
        hasNote: Boolean(summary),
        hasEvidence: Boolean(stagedEvidence.value),
      });
      if (stagedEvidence.value) {
        const preparedEvidence = stagedEvidence.value;
        const evidenceInserted = await tx.insert(leadEvidences).values({
          partnerId: context.partnerId,
          leadId: lead.id,
          timelineEventId,
          uploadedByMembershipId: actorMembershipId,
          storageProvider: preparedEvidence.storageProvider,
          storageKey: preparedEvidence.storageKey,
          storageStatus: "available",
          fileName: preparedEvidence.fileName,
          mimeType: preparedEvidence.mimeType,
          sizeBytes: preparedEvidence.sizeBytes,
          checksum: preparedEvidence.checksum,
        });
        const evidenceId = insertedId(
          evidenceInserted,
          "Não foi possível vincular a evidência à tentativa"
        );
        await writeV2Audit(transactionDb, {
          partnerId: context.partnerId,
          actorUserId: context.userId,
          actorMembershipId,
          action: "lead_evidence_uploaded",
          entityType: "lead_evidence",
          entityId: evidenceId,
          metadata: evidenceAuditMetadata({
            leadId: lead.id,
            timelineEventId,
            mimeType: preparedEvidence.mimeType,
            sizeBytes: preparedEvidence.sizeBytes,
            checksum: preparedEvidence.checksum,
          }),
        });
      }
      await completeCommand(
        transactionDb,
        context,
        "register_attempt",
        command.requestKey,
        timelineEventId
      );
      const updatedLead = await loadLead(transactionDb, context, lead.id);
      const nextAction = await deriveOperationalNextAction(
        transactionDb,
        context.partnerId,
        lead.id
      );
      return operationResponse({
        operation: "register_attempt",
        lead: updatedLead,
        timelineEvent: {
          id: timelineEventId,
          type: "contact_attempted",
          occurredAt,
          payload: timelinePayload,
        },
        governance: {
          timelineEventId,
          ...governanceState,
          followUpSatisfied: true,
        },
        followUp,
        conversion: null,
        nextAction,
      });
    });
    stagedEvidence.value = null;
    return response;
  } catch (error) {
    await stagedEvidence.value?.cleanup().catch(() => undefined);
    throw error;
  }
}

export async function recordEffectiveContact(
  context: PartnerContext,
  input: RecordEffectiveContactInput
) {
  const db = await getV2Db();
  const actorMembershipId = await assertOperationalMembership(context);
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const command = await startCommand(
      transactionDb,
      context,
      "record_effective_contact",
      input.requestKey
    );
    if (command.existing) {
      return replayCompletedCommand(transactionDb, context, command.existing);
    }

    const lead = await loadLead(transactionDb, context, input.leadId);
    await assertLeadScope(transactionDb, context, lead, "operational");
    await assertCampaignOperational(transactionDb, context, lead);
    await assertLeadOpenForCommercialOperation(transactionDb, context, lead);
    const channel = normalizedChannel(input.channel);
    const result = await getActiveResult(
      transactionDb,
      context,
      input.resultId,
      "effective_contact"
    );
    const effectiveGovernance = await resolveEffectiveGovernance(
      transactionDb,
      context.partnerId,
      lead.campaignId
    );
    const baseRule = resolveGovernanceForContact(
      effectiveGovernance.rule,
      channel
    );
    const followUpRequired = isFollowUpRequired({
      governanceRequiresFollowUp: baseRule.followUpRequired,
      resultPolicy: result.followUpPolicy,
    });
    const rule: GovernanceRule = { ...baseRule, followUpRequired };
    const summary = normalizedText(input.summary);
    const occurredAt = input.occurredAt ?? new Date();
    if (input.followUp && input.followUp.dueAt.getTime() <= Date.now()) {
      throw new Error(
        "O próximo follow-up deve ser agendado para uma data futura"
      );
    }
    assertContactGovernance(rule, {
      channel,
      outcome: result.code,
      summary,
      followUpDueAt: input.followUp?.dueAt ?? null,
    });
    const finalStatusId = resolveEffectiveContactFinalStatus({
      role: context.role,
      policy: result,
      requestedStatusId: input.finalStatusId,
    });
    const finalStatus = finalStatusId
      ? await getActiveStatus(transactionDb, context.partnerId, finalStatusId)
      : null;
    const conversionEligible = assertConversionStatus({
      conversionMode: result.conversionMode,
      statusIsTerminal: finalStatus?.isTerminal ?? false,
      statusCategory: finalStatus?.category ?? "open",
    });
    assertFollowUpApplicability({
      governanceRequiresFollowUp: baseRule.followUpRequired,
      resultPolicy: result.followUpPolicy,
      hasFollowUp: Boolean(input.followUp),
    });
    const followUp = input.followUp
      ? await createProvisionalFollowUp(
          transactionDb,
          context,
          lead,
          input.followUp
        )
      : null;
    const governancePreview = evaluateTreatmentGovernance(rule, {
      hasNote: Boolean(summary),
      hasFollowUp: Boolean(followUp),
      hasEvidence: false,
    });
    const timelinePayload = {
      channel,
      resultCode: result.code,
      resultLabel: result.label,
      resultCategory: result.category,
      previousStatusId: lead.statusId,
      finalStatusId: finalStatus?.id ?? null,
      followUpId: followUp?.id ?? null,
      governance: {
        isComplete: governancePreview.isComplete,
        evidencePending: !governancePreview.evidenceSatisfied,
      },
    };
    const timelineEventId = await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId: lead.id,
      actorMembershipId,
      type: "effective_contact_recorded",
      occurredAt,
      payload: timelinePayload,
    });
    if (followUp) {
      await bindFollowUpToOrigin(
        transactionDb,
        context,
        lead.id,
        followUp.id,
        timelineEventId
      );
      await recalculateNextFollowUp(transactionDb, context.partnerId, lead.id);
    }
    const contactInserted = await tx.insert(leadContacts).values({
      partnerId: context.partnerId,
      leadId: lead.id,
      actorMembershipId,
      recordKind: "effective_contact",
      timelineEventId,
      channel,
      // `outcome` remains a display-compatible copy. New domain behavior uses
      // resultId/resultCode and never derives policy from this text.
      outcome: result.label,
      resultId: result.id,
      resultCode: result.code,
      resultLabel: result.label,
      resultCategory: result.category,
      summary,
      occurredAt,
    });
    const contactId = insertedId(
      contactInserted,
      "Não foi possível registrar o contato efetivo"
    );

    if (finalStatus) {
      await conditionalStatusUpdate(transactionDb, {
        context,
        lead,
        expectedStatusId: input.expectedStatusId,
        statusId: finalStatus.id,
        occurredAt,
        firstEffectiveContact: true,
      });
    } else {
      await updateEffectiveContactActivity(
        transactionDb,
        context,
        lead,
        occurredAt
      );
    }
    const governanceState = await writeEffectiveContactGovernance(
      transactionDb,
      {
        context,
        leadId: lead.id,
        timelineEventId,
        source: effectiveGovernance.source,
        rule,
        hasNote: Boolean(summary),
        hasFollowUp: Boolean(followUp),
      }
    );

    let conversion: typeof leadConversions.$inferSelect | null = null;
    if (conversionEligible && finalStatus) {
      assertConversionSource({
        contactRecordKind: "effective_contact",
        resultInteractionKind: result.interactionKind,
        resultConversionMode: result.conversionMode,
        statusIsTerminal: finalStatus.isTerminal,
        statusCategory: finalStatus.category,
      });
      // `lead_conversions` requires an immutable timeline target, while the
      // conversion event should also name the generated conversion id. Within
      // this single transaction we use the effective-contact event as a
      // temporary valid FK target, then bind the new conversion event before
      // commit. No inconsistent relationship is ever observable externally.
      const conversionInserted = await tx.insert(leadConversions).values({
        partnerId: context.partnerId,
        leadId: lead.id,
        effectiveContactId: contactId,
        timelineEventId,
        resultId: result.id,
        statusId: finalStatus.id,
        actorMembershipId,
        occurredAt,
      });
      const conversionId = insertedId(
        conversionInserted,
        "Não foi possível registrar a conversão"
      );
      const conversionTimelineEventId = await writeTimeline(transactionDb, {
        partnerId: context.partnerId,
        leadId: lead.id,
        actorMembershipId,
        type: "conversion_recorded",
        occurredAt,
        payload: {
          conversionId,
          effectiveContactTimelineEventId: timelineEventId,
          resultCode: result.code,
          resultLabel: result.label,
          resultCategory: result.category,
          statusId: finalStatus.id,
        },
      });
      const rebound = await transactionDb
        .update(leadConversions)
        .set({ timelineEventId: conversionTimelineEventId })
        .where(
          and(
            eq(leadConversions.partnerId, context.partnerId),
            eq(leadConversions.id, conversionId),
            eq(leadConversions.timelineEventId, timelineEventId)
          )
        );
      if (affectedRows(rebound) !== 1) {
        throw new Error("Não foi possível vincular o evento de conversão");
      }
      conversion =
        (
          await transactionDb
            .select()
            .from(leadConversions)
            .where(
              and(
                eq(leadConversions.partnerId, context.partnerId),
                eq(leadConversions.id, conversionId)
              )
            )
            .limit(1)
        )[0] ?? null;
    }
    await completeCommand(
      transactionDb,
      context,
      "record_effective_contact",
      command.requestKey,
      timelineEventId
    );
    const updatedLead = await loadLead(transactionDb, context, lead.id);
    const nextAction = await deriveOperationalNextAction(
      transactionDb,
      context.partnerId,
      lead.id
    );
    return operationResponse({
      operation: "record_effective_contact",
      lead: updatedLead,
      timelineEvent: {
        id: timelineEventId,
        type: "effective_contact_recorded",
        occurredAt,
        payload: timelinePayload,
      },
      governance: { timelineEventId, ...governanceState },
      followUp,
      conversion,
      nextAction,
    });
  });
}

async function assertAdministrativeLead(
  db: V2Database,
  context: PartnerContext,
  leadId: number
) {
  assertAdministrativeStatusRole(context.role);
  const lead = await loadLead(db, context, leadId);
  await assertLeadScope(db, context, lead, "read");
  await assertCampaignOperational(db, context, lead);
  return lead;
}

export async function changeAdministrativeStatus(
  context: PartnerContext,
  input: ChangeAdministrativeStatusInput
) {
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const command = await startCommand(
      transactionDb,
      context,
      "change_administrative_status",
      input.requestKey
    );
    if (command.existing) {
      return replayCompletedCommand(transactionDb, context, command.existing);
    }
    const lead = await assertAdministrativeLead(
      transactionDb,
      context,
      input.leadId
    );
    const [previousStatus, nextStatus] = await Promise.all([
      getCurrentStatus(transactionDb, context.partnerId, lead.statusId),
      getActiveStatus(transactionDb, context.partnerId, input.statusId),
    ]);
    const reason = normalizedReason(input.reason);
    assertAdministrativeStatusTransition({
      previousIsTerminal: previousStatus.isTerminal,
      nextIsTerminal: nextStatus.isTerminal,
    });
    if (
      requiresAdministrativeStatusReason({
        previousIsTerminal: previousStatus.isTerminal,
        nextIsTerminal: nextStatus.isTerminal,
      }) &&
      !reason
    ) {
      throw new Error("Motivo obrigatório para este ajuste administrativo");
    }
    const occurredAt = new Date();
    await conditionalStatusUpdate(transactionDb, {
      context,
      lead,
      expectedStatusId: input.expectedStatusId,
      statusId: nextStatus.id,
      occurredAt,
    });
    const timelinePayload = {
      previousStatusId: previousStatus.id,
      previousStatusCode: previousStatus.code,
      statusId: nextStatus.id,
      statusCode: nextStatus.code,
      reason,
    };
    const timelineEventId = await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId: lead.id,
      actorMembershipId: context.membershipId,
      type: "administrative_status_changed",
      occurredAt,
      payload: timelinePayload,
    });
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_administrative_status_changed",
      entityType: "lead",
      entityId: lead.id,
      metadata: {
        previousStatusId: previousStatus.id,
        statusId: nextStatus.id,
        hasReason: Boolean(reason),
      },
    });
    await completeCommand(
      transactionDb,
      context,
      "change_administrative_status",
      command.requestKey,
      timelineEventId
    );
    const updatedLead = await loadLead(transactionDb, context, lead.id);
    const nextAction = await deriveOperationalNextAction(
      transactionDb,
      context.partnerId,
      lead.id
    );
    return operationResponse({
      operation: "change_administrative_status",
      lead: updatedLead,
      timelineEvent: {
        id: timelineEventId,
        type: "administrative_status_changed",
        occurredAt,
        payload: timelinePayload,
      },
      governance: null,
      followUp: null,
      conversion: null,
      nextAction,
    });
  });
}

export async function reopenLead(
  context: PartnerContext,
  input: ReopenLeadInput
) {
  const db = await getV2Db();
  assertReopenRole(context.role);
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const command = await startCommand(
      transactionDb,
      context,
      "reopen_lead",
      input.requestKey
    );
    if (command.existing) {
      return replayCompletedCommand(transactionDb, context, command.existing);
    }
    const lead = await assertAdministrativeLead(
      transactionDb,
      context,
      input.leadId
    );
    const previousStatus = await getCurrentStatus(
      transactionDb,
      context.partnerId,
      lead.statusId
    );
    if (!previousStatus.isTerminal) {
      throw new Error("Somente um lead terminal pode ser reaberto");
    }
    if (input.expectedStatusId !== lead.statusId) {
      throw new LeadJourneyOperationError(
        "LEAD_STATUS_CONFLICT",
        "A situação do lead foi alterada por outro usuário"
      );
    }
    const nextStatus = await getActiveStatus(
      transactionDb,
      context.partnerId,
      input.statusId
    );
    if (nextStatus.isTerminal) {
      throw new Error(
        "A reabertura exige uma situação operacional não terminal"
      );
    }
    const reason = normalizedReason(input.reason);
    if (!reason) throw new Error("Motivo obrigatório para reabrir o lead");
    const occurredAt = new Date();
    await conditionalStatusUpdate(transactionDb, {
      context,
      lead,
      expectedStatusId: input.expectedStatusId,
      statusId: nextStatus.id,
      occurredAt,
    });
    const timelinePayload = {
      previousStatusId: previousStatus.id,
      previousStatusCode: previousStatus.code,
      statusId: nextStatus.id,
      statusCode: nextStatus.code,
      reason,
    };
    const timelineEventId = await writeTimeline(transactionDb, {
      partnerId: context.partnerId,
      leadId: lead.id,
      actorMembershipId: context.membershipId,
      type: "lead_reopened",
      occurredAt,
      payload: timelinePayload,
    });
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_reopened",
      entityType: "lead",
      entityId: lead.id,
      metadata: {
        previousStatusId: previousStatus.id,
        statusId: nextStatus.id,
        hasReason: true,
      },
    });
    await completeCommand(
      transactionDb,
      context,
      "reopen_lead",
      command.requestKey,
      timelineEventId
    );
    const updatedLead = await loadLead(transactionDb, context, lead.id);
    const nextAction = await deriveOperationalNextAction(
      transactionDb,
      context.partnerId,
      lead.id
    );
    return operationResponse({
      operation: "reopen_lead",
      lead: updatedLead,
      timelineEvent: {
        id: timelineEventId,
        type: "lead_reopened",
        occurredAt,
        payload: timelinePayload,
      },
      governance: null,
      followUp: null,
      conversion: null,
      nextAction,
    });
  });
}

/** Public read helper used by future UI/API composition without duplicating priority policy in React. */
export async function getLeadNextAction(
  context: PartnerContext,
  leadId: number
) {
  const db = await getV2Db();
  const lead = await loadLead(db, context, leadId);
  await assertLeadScope(db, context, lead, "read");
  return deriveOperationalNextAction(db, context.partnerId, lead.id);
}
