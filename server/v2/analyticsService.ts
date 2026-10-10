import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  min,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  campaignPdvs,
  campaigns,
  customFieldDefinitions,
  followUps,
  leadContactAttempts,
  leadContacts,
  leadConversions,
  leadDistributionBatches,
  leadEvidences,
  leadImportBatches,
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
import type { PartnerContext } from "./access";
import {
  analyticsMetricDefinitions,
  dateForAnalyticsInput,
  percentageChange,
  resolveAnalyticsPeriod,
  safeRate,
  type AnalyticsDateRangeInput,
  type AnalyticsPeriod,
  type AnalyticsPeriodPreset,
} from "./analyticsDomain";
import { getV2Db, type V2Database } from "./database";
import { partnerDayBounds } from "./partnerTime";
import { writeV2Audit } from "./partnerService";
import {
  pdvIsInsideAnalyticsScope,
  sellerIsInsideAnalyticsScope,
} from "./analyticsScopePolicy";
import { resolvePdvScope } from "./pdvScope";

const REPORT_PAGE_MAX = 100;
const EXPORT_ROW_MAX = 25_000;
const OPERATION_EVENT_TYPES = [
  "contact_attempted",
  "effective_contact_recorded",
] as const;

export type AnalyticsFilters = AnalyticsDateRangeInput & {
  campaignId?: number;
  pdvId?: number;
  sellerMembershipId?: number;
};

export type AnalyticsReportType =
  | "leads"
  | "attempts"
  | "treatments"
  | "conversions"
  | "follow_ups"
  | "imports"
  | "distributions";

export type AnalyticsReportInput = AnalyticsFilters & {
  type: AnalyticsReportType;
  page: number;
  pageSize: number;
  evidenceFilter?: "with_evidence" | "without_evidence" | "required_pending";
  followUpSituation?:
    | "overdue"
    | "today"
    | "upcoming"
    | "pending"
    | "completed"
    | "cancelled";
  followUpDateField?: "dueAt" | "createdAt";
};

export type AnalyticsHealthDetailKind =
  | "unassigned"
  | "assigned_without_work"
  | "follow_ups_overdue"
  | "governance_pending"
  | "awaiting_response"
  | "terminal_residual_follow_ups"
  | "evidence_eligible"
  | "evidence_with"
  | "evidence_without"
  | "evidence_required_pending"
  | "attempt_evidence_eligible"
  | "attempt_evidence_with"
  | "attempt_evidence_without"
  | "attempt_evidence_required_pending";

export type AnalyticsHealthDetailInput = AnalyticsFilters & {
  kind: AnalyticsHealthDetailKind;
  page: number;
  pageSize: number;
};

export type AnalyticsReportRow = Record<string, string | number | null>;
export type AnalyticsReportColumn = { key: string; label: string };
export type AnalyticsReportPage = {
  type: AnalyticsReportType;
  columns: AnalyticsReportColumn[];
  rows: AnalyticsReportRow[];
  total: number;
  page: number;
  pageSize: number;
  period: { start: Date; end: Date; timeZone: string; label: string };
};

type AnalyticsScope = {
  pdvIds: number[] | null;
  ownMembershipId: number | null;
};

type AnalyticsContext = {
  db: V2Database;
  scope: AnalyticsScope;
  period: AnalyticsPeriod;
  now: Date;
  staleLeadMinutes: number;
};

type AnalyticsSeller = {
  membershipId: number;
  name: string;
  pdvIds: number[];
  pdvNames: string[];
};

type OperationMetrics = {
  worked: number;
  leadsWithAttempt: number;
  attempts: number;
  leadsWithEffectiveContact: number;
  effectiveContacts: number;
  interested: number;
  conversions: number;
  leadsConverted: number;
};

function numberOf(value: unknown) {
  return Number(value ?? 0);
}

function valueOfDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function parseRule(value: unknown) {
  if (!value || typeof value !== "object") return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function evidenceState(rule: unknown, hasEvidence: number | boolean) {
  const required = parseRule(rule).evidenceRequired === true;
  const available = Boolean(hasEvidence);
  return {
    required,
    available,
    governance: required && !available ? "Pendente" : "Completa",
  };
}

function documentaryStatus(rule: unknown, evidenceCount: number | boolean) {
  const required = parseRule(rule).evidenceRequired === true;
  if (!required) return "Não exigida";
  return Number(evidenceCount) > 0 ? "Atendida" : "Pendente";
}

function scopeLeadConditions(
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  options: { includeOwner?: boolean } = {}
) {
  const conditions: SQL[] = [
    eq(leads.partnerId, context.partnerId),
    isNull(leads.deletedAt),
  ];
  if (scope.pdvIds) conditions.push(inArray(leads.pdvId, scope.pdvIds));
  if (filters.campaignId)
    conditions.push(eq(leads.campaignId, filters.campaignId));
  if (filters.pdvId) conditions.push(eq(leads.pdvId, filters.pdvId));
  if (options.includeOwner !== false) {
    const owner = scope.ownMembershipId ?? filters.sellerMembershipId;
    if (owner) conditions.push(eq(leads.assignedMembershipId, owner));
  }
  return conditions;
}

async function resolveAnalyticsScope(
  db: V2Database,
  context: PartnerContext
): Promise<AnalyticsScope> {
  const pdvIds = await resolvePdvScope(db, context);
  return {
    pdvIds,
    ownMembershipId: context.role === "seller" ? context.membershipId : null,
  };
}

async function assertAnalyticsFilters(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters
) {
  if (scope.pdvIds && !scope.pdvIds.length) {
    throw new Error("Não há PDVs ativos no seu escopo analítico");
  }
  if (filters.pdvId) {
    const row = (
      await db
        .select({ id: pdvs.id })
        .from(pdvs)
        .where(
          and(eq(pdvs.id, filters.pdvId), eq(pdvs.partnerId, context.partnerId))
        )
        .limit(1)
    )[0];
    if (!row || !pdvIsInsideAnalyticsScope(scope.pdvIds, filters.pdvId)) {
      throw new Error("PDV indisponível no seu escopo");
    }
  }
  if (filters.campaignId) {
    const row = (
      await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.id, filters.campaignId),
            eq(campaigns.partnerId, context.partnerId)
          )
        )
        .limit(1)
    )[0];
    if (!row) throw new Error("Campanha indisponível no seu escopo");
    if (scope.pdvIds) {
      const mapped = (
        await db
          .select({ id: campaignPdvs.id })
          .from(campaignPdvs)
          .where(
            and(
              eq(campaignPdvs.partnerId, context.partnerId),
              eq(campaignPdvs.campaignId, filters.campaignId),
              inArray(campaignPdvs.pdvId, scope.pdvIds)
            )
          )
          .limit(1)
      )[0];
      if (!mapped) throw new Error("Campanha indisponível no seu escopo");
    }
  }
  if (filters.sellerMembershipId) {
    if (
      !sellerIsInsideAnalyticsScope(
        scope.ownMembershipId,
        filters.sellerMembershipId
      )
    ) {
      throw new Error("Vendedor indisponível no seu escopo");
    }
    const seller = (
      await db
        .select({ id: userPartners.id })
        .from(userPartners)
        .innerJoin(users, eq(users.id, userPartners.userId))
        .where(
          and(
            eq(userPartners.id, filters.sellerMembershipId),
            eq(userPartners.partnerId, context.partnerId),
            eq(userPartners.role, "seller"),
            eq(userPartners.isActive, true),
            eq(users.isActive, true)
          )
        )
        .limit(1)
    )[0];
    if (!seller) throw new Error("Vendedor indisponível no seu escopo");
  }
}

async function createAnalyticsContext(
  context: PartnerContext,
  filters: AnalyticsFilters
): Promise<AnalyticsContext> {
  const db = await getV2Db();
  const scope = await resolveAnalyticsScope(db, context);
  await assertAnalyticsFilters(db, context, scope, filters);
  const settings = (
    await db
      .select({
        timezone: partnerSettings.timezone,
        stale: partnerSettings.staleLeadMinutes,
      })
      .from(partnerSettings)
      .where(eq(partnerSettings.partnerId, context.partnerId))
      .limit(1)
  )[0];
  const timeZone = settings?.timezone ?? "America/Sao_Paulo";
  return {
    db,
    scope,
    period: resolveAnalyticsPeriod(timeZone, filters),
    now: new Date(),
    staleLeadMinutes: settings?.stale ?? 1_440,
  };
}

function withPeriod(
  conditions: SQL[],
  column:
    | typeof leadContactAttempts.occurredAt
    | typeof leadContacts.occurredAt
    | typeof leadConversions.occurredAt
    | typeof leadTimelineEvents.occurredAt,
  period: Pick<AnalyticsPeriod, "start" | "end">
) {
  return [...conditions, gte(column, period.start), lt(column, period.end)];
}

async function queryOperationMetrics(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  period: Pick<AnalyticsPeriod, "start" | "end">
): Promise<OperationMetrics> {
  const leadConditions = scopeLeadConditions(context, scope, filters);
  const attemptsConditions = withPeriod(
    [...leadConditions, eq(leadContactAttempts.partnerId, context.partnerId)],
    leadContactAttempts.occurredAt,
    period
  );
  const contactsConditions = withPeriod(
    [
      ...leadConditions,
      eq(leadContacts.partnerId, context.partnerId),
      eq(leadContacts.recordKind, "effective_contact"),
    ],
    leadContacts.occurredAt,
    period
  );
  const conversionConditions = withPeriod(
    [...leadConditions, eq(leadConversions.partnerId, context.partnerId)],
    leadConversions.occurredAt,
    period
  );
  const workConditions = withPeriod(
    [
      ...leadConditions,
      eq(leadTimelineEvents.partnerId, context.partnerId),
      inArray(leadTimelineEvents.type, [...OPERATION_EVENT_TYPES]),
    ],
    leadTimelineEvents.occurredAt,
    period
  );
  const [attemptRows, contactRows, interestedRows, conversionRows, workedRows] =
    await Promise.all([
      db
        .select({
          total: count(),
          leads: countDistinct(leadContactAttempts.leadId),
        })
        .from(leadContactAttempts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContactAttempts.leadId),
            eq(leads.partnerId, leadContactAttempts.partnerId)
          )
        )
        .where(and(...attemptsConditions)),
      db
        .select({ total: count(), leads: countDistinct(leadContacts.leadId) })
        .from(leadContacts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContacts.leadId),
            eq(leads.partnerId, leadContacts.partnerId)
          )
        )
        .where(and(...contactsConditions)),
      db
        .select({ leads: countDistinct(leadContacts.leadId) })
        .from(leadContacts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContacts.leadId),
            eq(leads.partnerId, leadContacts.partnerId)
          )
        )
        .where(
          and(
            ...contactsConditions,
            eq(leadContacts.resultCategory, "interested")
          )
        ),
      db
        .select({
          total: count(),
          leads: countDistinct(leadConversions.leadId),
        })
        .from(leadConversions)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadConversions.leadId),
            eq(leads.partnerId, leadConversions.partnerId)
          )
        )
        .where(and(...conversionConditions)),
      db
        .select({ leads: countDistinct(leadTimelineEvents.leadId) })
        .from(leadTimelineEvents)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadTimelineEvents.leadId),
            eq(leads.partnerId, leadTimelineEvents.partnerId)
          )
        )
        .where(and(...workConditions)),
    ]);
  return {
    worked: numberOf(workedRows[0]?.leads),
    leadsWithAttempt: numberOf(attemptRows[0]?.leads),
    attempts: numberOf(attemptRows[0]?.total),
    leadsWithEffectiveContact: numberOf(contactRows[0]?.leads),
    effectiveContacts: numberOf(contactRows[0]?.total),
    interested: numberOf(interestedRows[0]?.leads),
    conversions: numberOf(conversionRows[0]?.total),
    leadsConverted: numberOf(conversionRows[0]?.leads),
  };
}

async function queryCohortFunnel(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  period: Pick<AnalyticsPeriod, "start" | "end">
) {
  const cohortConditions = [
    ...scopeLeadConditions(context, scope, filters),
    gte(leads.receivedAt, period.start),
    lt(leads.receivedAt, period.end),
  ];
  const factBeforeEnd = <
    T extends
      | typeof leadContactAttempts
      | typeof leadContacts
      | typeof leadConversions
      | typeof leadTimelineEvents,
  >(
    table: T,
    occurredAt: T extends typeof leadContactAttempts
      ? typeof leadContactAttempts.occurredAt
      : T extends typeof leadContacts
        ? typeof leadContacts.occurredAt
        : T extends typeof leadConversions
          ? typeof leadConversions.occurredAt
          : typeof leadTimelineEvents.occurredAt
  ) => [eq(table.partnerId, context.partnerId), lt(occurredAt, period.end)];
  const [
    receivedRows,
    workedRows,
    attemptedRows,
    contactedRows,
    interestedRows,
    convertedRows,
  ] = await Promise.all([
    db
      .select({ total: count() })
      .from(leads)
      .where(and(...cohortConditions)),
    db
      .select({ total: countDistinct(leadTimelineEvents.leadId) })
      .from(leadTimelineEvents)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadTimelineEvents.leadId),
          eq(leads.partnerId, leadTimelineEvents.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          ...factBeforeEnd(leadTimelineEvents, leadTimelineEvents.occurredAt),
          inArray(leadTimelineEvents.type, [...OPERATION_EVENT_TYPES])
        )
      ),
    db
      .select({ total: countDistinct(leadContactAttempts.leadId) })
      .from(leadContactAttempts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContactAttempts.leadId),
          eq(leads.partnerId, leadContactAttempts.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          ...factBeforeEnd(leadContactAttempts, leadContactAttempts.occurredAt)
        )
      ),
    db
      .select({ total: countDistinct(leadContacts.leadId) })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          ...factBeforeEnd(leadContacts, leadContacts.occurredAt),
          eq(leadContacts.recordKind, "effective_contact")
        )
      ),
    db
      .select({ total: countDistinct(leadContacts.leadId) })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          ...factBeforeEnd(leadContacts, leadContacts.occurredAt),
          eq(leadContacts.recordKind, "effective_contact"),
          eq(leadContacts.resultCategory, "interested")
        )
      ),
    db
      .select({ total: countDistinct(leadConversions.leadId) })
      .from(leadConversions)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadConversions.leadId),
          eq(leads.partnerId, leadConversions.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          ...factBeforeEnd(leadConversions, leadConversions.occurredAt)
        )
      ),
  ]);
  return {
    received: numberOf(receivedRows[0]?.total),
    worked: numberOf(workedRows[0]?.total),
    attempted: numberOf(attemptedRows[0]?.total),
    contacted: numberOf(contactedRows[0]?.total),
    interested: numberOf(interestedRows[0]?.total),
    converted: numberOf(convertedRows[0]?.total),
  };
}

async function queryDashboardStocks(
  analytics: AnalyticsContext,
  context: PartnerContext,
  filters: AnalyticsFilters
) {
  const { db, scope, now, period, staleLeadMinutes } = analytics;
  const leadConditions = scopeLeadConditions(context, scope, filters);
  const day = partnerDayBounds(period.timeZone, now);
  const staleBefore = new Date(now.getTime() - staleLeadMinutes * 60_000);
  const nonTerminal = alias(leadStatuses, "analytics_stock_status");
  const [stockRows, followUpRows, governanceRows, awaitingRows, residualRows] =
    await Promise.all([
      db
        .select({
          available: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is null then 1 else 0 end), 0)`,
          inPortfolio: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is not null then 1 else 0 end), 0)`,
          withoutWork: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is not null and ${leads.firstAttemptAt} is null and ${leads.firstEffectiveContactAt} is null then 1 else 0 end), 0)`,
          stale: sql<number>`coalesce(sum(case when (${leads.lastActivityAt} is null or ${leads.lastActivityAt} < ${staleBefore}) then 1 else 0 end), 0)`,
        })
        .from(leads)
        .innerJoin(nonTerminal, eq(nonTerminal.id, leads.statusId))
        .where(and(...leadConditions, eq(nonTerminal.isTerminal, false))),
      db
        .select({
          overdue: sql<number>`coalesce(sum(case when ${followUps.dueAt} < ${now} then 1 else 0 end), 0)`,
          today: sql<number>`coalesce(sum(case when ${followUps.dueAt} >= ${day.start} and ${followUps.dueAt} < ${day.end} then 1 else 0 end), 0)`,
        })
        .from(followUps)
        .innerJoin(
          leads,
          and(
            eq(leads.id, followUps.leadId),
            eq(leads.partnerId, followUps.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(followUps.partnerId, context.partnerId),
            eq(followUps.status, "pending")
          )
        ),
      db
        .select({ total: countDistinct(leadTreatmentGovernance.id) })
        .from(leadTreatmentGovernance)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadTreatmentGovernance.leadId),
            eq(leads.partnerId, leadTreatmentGovernance.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(leadTreatmentGovernance.partnerId, context.partnerId),
            eq(leadTreatmentGovernance.isComplete, false),
            inArray(leadTreatmentGovernance.operationKind, [
              "attempt",
              "effective_contact",
            ])
          )
        ),
      db
        .select({ total: countDistinct(leadContactAttempts.leadId) })
        .from(leadContactAttempts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContactAttempts.leadId),
            eq(leads.partnerId, leadContactAttempts.partnerId)
          )
        )
        .innerJoin(nonTerminal, eq(nonTerminal.id, leads.statusId))
        .where(
          and(
            ...leadConditions,
            eq(leadContactAttempts.partnerId, context.partnerId),
            eq(leadContactAttempts.resultCategory, "awaiting_response"),
            eq(nonTerminal.isTerminal, false)
          )
        ),
      db
        .select({ total: countDistinct(followUps.leadId) })
        .from(followUps)
        .innerJoin(
          leads,
          and(
            eq(leads.id, followUps.leadId),
            eq(leads.partnerId, followUps.partnerId)
          )
        )
        .innerJoin(nonTerminal, eq(nonTerminal.id, leads.statusId))
        .where(
          and(
            ...leadConditions,
            eq(followUps.partnerId, context.partnerId),
            eq(followUps.status, "pending"),
            eq(nonTerminal.isTerminal, true)
          )
        ),
    ]);
  return {
    available: numberOf(stockRows[0]?.available),
    inPortfolio: numberOf(stockRows[0]?.inPortfolio),
    assignedWithoutWork: numberOf(stockRows[0]?.withoutWork),
    stale: numberOf(stockRows[0]?.stale),
    followUpsOverdue: numberOf(followUpRows[0]?.overdue),
    followUpsToday: numberOf(followUpRows[0]?.today),
    governancePending: numberOf(governanceRows[0]?.total),
    awaitingResponse: numberOf(awaitingRows[0]?.total),
    terminalResidualFollowUps: numberOf(residualRows[0]?.total),
  };
}

/**
 * Coverage is deliberately calculated per effective-contact event, not per
 * Lead. The correlated evidence lookup is backed by the existing
 * partner/event/active-storage index and keeps optional evidence distinct from
 * a documentary governance failure.
 */
async function queryEvidenceCoverage(
  analytics: AnalyticsContext,
  context: PartnerContext,
  filters: AnalyticsFilters
) {
  const { db, scope, period } = analytics;
  const governance = alias(
    leadTreatmentGovernance,
    "analytics_evidence_governance"
  );
  const evidenceExists = sql<number>`exists (select 1 from ${leadEvidences} where ${leadEvidences.partnerId} = ${leadContacts.partnerId} and ${leadEvidences.leadId} = ${leadContacts.leadId} and ${leadEvidences.timelineEventId} = ${leadContacts.timelineEventId} and ${leadEvidences.deletedAt} is null and ${leadEvidences.storageStatus} = 'available')`;
  const requiredEvidence = sql<number>`coalesce(json_extract(${governance.appliedRuleJson}, '$.evidenceRequired'), false)`;
  const conditions = withPeriod(
    [
      ...scopeLeadConditions(context, scope, filters),
      eq(leadContacts.partnerId, context.partnerId),
      eq(leadContacts.recordKind, "effective_contact"),
    ],
    leadContacts.occurredAt,
    period
  );
  const rows = await db
    .select({
      eligible: count(),
      withEvidence: sql<number>`coalesce(sum(case when ${evidenceExists} then 1 else 0 end), 0)`,
      requiredPending: sql<number>`coalesce(sum(case when ${requiredEvidence} and not ${evidenceExists} then 1 else 0 end), 0)`,
    })
    .from(leadContacts)
    .innerJoin(
      leads,
      and(
        eq(leads.id, leadContacts.leadId),
        eq(leads.partnerId, leadContacts.partnerId)
      )
    )
    .leftJoin(
      governance,
      and(
        eq(governance.partnerId, leadContacts.partnerId),
        eq(governance.leadId, leadContacts.leadId),
        eq(governance.timelineEventId, leadContacts.timelineEventId)
      )
    )
    .where(and(...conditions));
  const eligible = numberOf(rows[0]?.eligible);
  const withEvidence = numberOf(rows[0]?.withEvidence);
  const attemptGovernance = alias(
    leadTreatmentGovernance,
    "analytics_attempt_evidence_governance"
  );
  const attemptEvidenceExists = sql<number>`exists (select 1 from ${leadEvidences} where ${leadEvidences.partnerId} = ${leadContactAttempts.partnerId} and ${leadEvidences.leadId} = ${leadContactAttempts.leadId} and ${leadEvidences.timelineEventId} = ${leadContactAttempts.timelineEventId} and ${leadEvidences.deletedAt} is null and ${leadEvidences.storageStatus} = 'available')`;
  const attemptRequiredEvidence = sql<number>`coalesce(json_extract(${attemptGovernance.appliedRuleJson}, '$.evidenceRequired'), false)`;
  const attemptConditions = withPeriod(
    [
      ...scopeLeadConditions(context, scope, filters),
      eq(leadContactAttempts.partnerId, context.partnerId),
    ],
    leadContactAttempts.occurredAt,
    period
  );
  const attemptRows = await db
    .select({
      eligible: count(),
      withEvidence: sql<number>`coalesce(sum(case when ${attemptEvidenceExists} then 1 else 0 end), 0)`,
      requiredPending: sql<number>`coalesce(sum(case when ${attemptRequiredEvidence} and not ${attemptEvidenceExists} then 1 else 0 end), 0)`,
    })
    .from(leadContactAttempts)
    .innerJoin(
      leads,
      and(
        eq(leads.id, leadContactAttempts.leadId),
        eq(leads.partnerId, leadContactAttempts.partnerId)
      )
    )
    .leftJoin(
      attemptGovernance,
      and(
        eq(attemptGovernance.partnerId, leadContactAttempts.partnerId),
        eq(attemptGovernance.leadId, leadContactAttempts.leadId),
        eq(
          attemptGovernance.timelineEventId,
          leadContactAttempts.timelineEventId
        )
      )
    )
    .where(and(...attemptConditions));
  const attemptEligible = numberOf(attemptRows[0]?.eligible);
  const attemptWithEvidence = numberOf(attemptRows[0]?.withEvidence);
  return {
    eligible,
    withEvidence,
    withoutEvidence: Math.max(0, eligible - withEvidence),
    coverage: safeRate(withEvidence, eligible),
    requiredPending: numberOf(rows[0]?.requiredPending),
    attemptCoverage: {
      eligible: attemptEligible,
      withEvidence: attemptWithEvidence,
      withoutEvidence: Math.max(0, attemptEligible - attemptWithEvidence),
      coverage: safeRate(attemptWithEvidence, attemptEligible),
      requiredPending: numberOf(attemptRows[0]?.requiredPending),
    },
  };
}

async function queryFirstResponseTimes(
  analytics: AnalyticsContext,
  context: PartnerContext,
  filters: AnalyticsFilters
) {
  const { db, scope, period } = analytics;
  const leadConditions = scopeLeadConditions(context, scope, filters);
  const [attempt, effective] = await Promise.all([
    db
      .select({
        seconds: sql<
          number | null
        >`avg(timestampdiff(second, ${leads.receivedAt}, ${leads.firstAttemptAt}))`,
      })
      .from(leads)
      .where(
        and(
          ...leadConditions,
          isNotNull(leads.firstAttemptAt),
          gte(leads.firstAttemptAt, period.start),
          lt(leads.firstAttemptAt, period.end)
        )
      ),
    db
      .select({
        seconds: sql<
          number | null
        >`avg(timestampdiff(second, ${leads.receivedAt}, ${leads.firstEffectiveContactAt}))`,
      })
      .from(leads)
      .where(
        and(
          ...leadConditions,
          isNotNull(leads.firstEffectiveContactAt),
          gte(leads.firstEffectiveContactAt, period.start),
          lt(leads.firstEffectiveContactAt, period.end)
        )
      ),
  ]);
  return {
    firstAttemptAverageSeconds:
      attempt[0]?.seconds == null ? null : numberOf(attempt[0].seconds),
    firstEffectiveContactAverageSeconds:
      effective[0]?.seconds == null ? null : numberOf(effective[0].seconds),
  };
}

async function queryOverviewDimension(
  analytics: AnalyticsContext,
  context: PartnerContext,
  filters: AnalyticsFilters,
  dimension: "campaign" | "pdv"
) {
  const { db, scope, period, now } = analytics;
  const base = scopeLeadConditions(context, scope, filters);
  const dimensionId = dimension === "campaign" ? campaigns.id : pdvs.id;
  const dimensionName = dimension === "campaign" ? campaigns.name : pdvs.name;
  const dimensionJoin =
    dimension === "campaign"
      ? and(
          eq(campaigns.id, leads.campaignId),
          eq(campaigns.partnerId, leads.partnerId)
        )
      : and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId));
  const group = dimension === "campaign" ? campaigns : pdvs;
  const attemptGroup = dimension === "campaign" ? campaigns : pdvs;
  const contactGroup = dimension === "campaign" ? campaigns : pdvs;
  const conversionGroup = dimension === "campaign" ? campaigns : pdvs;
  const [leadRows, workedRows, attemptRows, contactRows, conversionRows, overdueRows] =
    await Promise.all([
      db
        .select({
          id: dimensionId,
          name: dimensionName,
          leads: countDistinct(leads.id),
        })
        .from(leads)
        .innerJoin(group, dimensionJoin)
        .where(and(...base))
        .groupBy(dimensionId, dimensionName),
      db
        .select({
          id: dimensionId,
          worked: countDistinct(leadTimelineEvents.leadId),
        })
        .from(leadTimelineEvents)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadTimelineEvents.leadId),
            eq(leads.partnerId, leadTimelineEvents.partnerId)
          )
        )
        .innerJoin(group, dimensionJoin)
        .where(
          and(
            ...base,
            eq(leadTimelineEvents.partnerId, context.partnerId),
            inArray(leadTimelineEvents.type, [...OPERATION_EVENT_TYPES]),
            gte(leadTimelineEvents.occurredAt, period.start),
            lt(leadTimelineEvents.occurredAt, period.end)
          )
        )
        .groupBy(dimensionId),
      db
        .select({
          id: dimensionId,
          attempts: count(),
          attempted: countDistinct(leadContactAttempts.leadId),
        })
        .from(leadContactAttempts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContactAttempts.leadId),
            eq(leads.partnerId, leadContactAttempts.partnerId)
          )
        )
        .innerJoin(attemptGroup, dimensionJoin)
        .where(
          and(
            ...base,
            eq(leadContactAttempts.partnerId, context.partnerId),
            gte(leadContactAttempts.occurredAt, period.start),
            lt(leadContactAttempts.occurredAt, period.end)
          )
        )
        .groupBy(dimensionId),
      db
        .select({
          id: dimensionId,
          contacts: count(),
          contacted: countDistinct(leadContacts.leadId),
          interested: sql<number>`coalesce(count(distinct case when ${leadContacts.resultCategory} = 'interested' then ${leadContacts.leadId} end), 0)`,
        })
        .from(leadContacts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContacts.leadId),
            eq(leads.partnerId, leadContacts.partnerId)
          )
        )
        .innerJoin(contactGroup, dimensionJoin)
        .where(
          and(
            ...base,
            eq(leadContacts.partnerId, context.partnerId),
            eq(leadContacts.recordKind, "effective_contact"),
            gte(leadContacts.occurredAt, period.start),
            lt(leadContacts.occurredAt, period.end)
          )
        )
        .groupBy(dimensionId),
      db
        .select({
          id: dimensionId,
          conversions: count(),
          converted: countDistinct(leadConversions.leadId),
        })
        .from(leadConversions)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadConversions.leadId),
            eq(leads.partnerId, leadConversions.partnerId)
          )
        )
        .innerJoin(conversionGroup, dimensionJoin)
        .where(
          and(
            ...base,
            eq(leadConversions.partnerId, context.partnerId),
            gte(leadConversions.occurredAt, period.start),
            lt(leadConversions.occurredAt, period.end)
          )
        )
        .groupBy(dimensionId),
      db
        .select({ id: dimensionId, overdue: countDistinct(followUps.id) })
        .from(followUps)
        .innerJoin(
          leads,
          and(
            eq(leads.id, followUps.leadId),
            eq(leads.partnerId, followUps.partnerId)
          )
        )
        .innerJoin(group, dimensionJoin)
        .where(
          and(
            ...base,
            eq(followUps.partnerId, context.partnerId),
            eq(followUps.status, "pending"),
            lt(followUps.dueAt, now)
          )
        )
        .groupBy(dimensionId),
    ]);
  const attempts = new Map(attemptRows.map(row => [row.id, row]));
  const worked = new Map(workedRows.map(row => [row.id, row]));
  const contacts = new Map(contactRows.map(row => [row.id, row]));
  const conversions = new Map(conversionRows.map(row => [row.id, row]));
  const overdue = new Map(overdueRows.map(row => [row.id, row]));
  return leadRows.map(row => {
    const attempt = attempts.get(row.id);
    const work = worked.get(row.id);
    const contact = contacts.get(row.id);
    const conversion = conversions.get(row.id);
    return {
      id: row.id,
      name: row.name,
      leads: numberOf(row.leads),
      leadsWorked: numberOf(work?.worked),
      workCoverage: safeRate(numberOf(work?.worked), numberOf(row.leads)),
      attempts: numberOf(attempt?.attempts),
      leadsWithAttempt: numberOf(attempt?.attempted),
      effectiveContacts: numberOf(contact?.contacts),
      leadsWithEffectiveContact: numberOf(contact?.contacted),
      effectiveContactRate: safeRate(
        numberOf(contact?.contacted),
        numberOf(work?.worked)
      ),
      interested: numberOf(contact?.interested),
      conversions: numberOf(conversion?.conversions),
      leadsConverted: numberOf(conversion?.converted),
      conversionRate: safeRate(
        numberOf(conversion?.converted),
        numberOf(contact?.contacted)
      ),
      followUpsOverdue: numberOf(overdue.get(row.id)?.overdue),
    };
  });
}

/** Central SQL dashboard provider. Browser code receives facts, never rules. */
export async function getDashboardAnalytics(
  context: PartnerContext,
  filters: AnalyticsFilters
) {
  const analytics = await createAnalyticsContext(context, filters);
  const { db, scope, period } = analytics;
  const [
    receivedRows,
    previousReceivedRows,
    activity,
    previousActivity,
    funnel,
    stocks,
    evidenceCoverage,
    times,
    campaignsOverview,
    pdvsOverview,
  ] = await Promise.all([
    db
      .select({ total: count() })
      .from(leads)
      .where(
        and(
          ...scopeLeadConditions(context, scope, filters),
          gte(leads.receivedAt, period.start),
          lt(leads.receivedAt, period.end)
        )
      ),
    db
      .select({ total: count() })
      .from(leads)
      .where(
        and(
          ...scopeLeadConditions(context, scope, filters),
          gte(leads.receivedAt, period.previousStart),
          lt(leads.receivedAt, period.previousEnd)
        )
      ),
    queryOperationMetrics(db, context, scope, filters, period),
    queryOperationMetrics(db, context, scope, filters, {
      start: period.previousStart,
      end: period.previousEnd,
    }),
    queryCohortFunnel(db, context, scope, filters, period),
    queryDashboardStocks(analytics, context, filters),
    queryEvidenceCoverage(analytics, context, filters),
    queryFirstResponseTimes(analytics, context, filters),
    queryOverviewDimension(analytics, context, filters, "campaign"),
    queryOverviewDimension(analytics, context, filters, "pdv"),
  ]);
  const received = numberOf(receivedRows[0]?.total);
  const previousReceived = numberOf(previousReceivedRows[0]?.total);
  const effectiveContactRate = safeRate(
    activity.leadsWithEffectiveContact,
    activity.worked
  );
  const previousEffectiveContactRate = safeRate(
    previousActivity.leadsWithEffectiveContact,
    previousActivity.worked
  );
  const conversionRate = safeRate(
    activity.leadsConverted,
    activity.leadsWithEffectiveContact
  );
  const previousConversionRate = safeRate(
    previousActivity.leadsConverted,
    previousActivity.leadsWithEffectiveContact
  );
  return {
    metricDefinitions: analyticsMetricDefinitions,
    period: {
      start: period.start,
      end: period.end,
      previousStart: period.previousStart,
      previousEnd: period.previousEnd,
      timeZone: period.timeZone,
      label: period.label,
    },
    cards: {
      leadsReceived: received,
      leadsBase: stocks.available + stocks.inPortfolio,
      leadsAvailable: stocks.available,
      leadsInPortfolio: stocks.inPortfolio,
      leadsWorked: activity.worked,
      leadsWithAttempt: activity.leadsWithAttempt,
      attempts: activity.attempts,
      leadsWithEffectiveContact: activity.leadsWithEffectiveContact,
      effectiveContacts: activity.effectiveContacts,
      interested: activity.interested,
      conversions: activity.conversions,
      leadsConverted: activity.leadsConverted,
      effectiveContactRate,
      conversionRate,
      followUpsOverdue: stocks.followUpsOverdue,
      followUpsToday: stocks.followUpsToday,
      ...times,
      leadsWithoutWork: stocks.assignedWithoutWork,
    },
    comparisons: {
      leadsReceived: percentageChange(received, previousReceived),
      leadsWorked: percentageChange(activity.worked, previousActivity.worked),
      attempts: percentageChange(activity.attempts, previousActivity.attempts),
      effectiveContacts: percentageChange(
        activity.effectiveContacts,
        previousActivity.effectiveContacts
      ),
      conversions: percentageChange(
        activity.conversions,
        previousActivity.conversions
      ),
      effectiveContactRate:
        effectiveContactRate == null || previousEffectiveContactRate == null
          ? null
          : percentageChange(
              effectiveContactRate,
              previousEffectiveContactRate
            ),
      conversionRate:
        conversionRate == null || previousConversionRate == null
          ? null
          : percentageChange(conversionRate, previousConversionRate),
    },
    funnel,
    health: {
      unassigned: stocks.available,
      assignedWithoutWork: stocks.assignedWithoutWork,
      followUpsOverdue: stocks.followUpsOverdue,
      staleLeads: stocks.stale,
      staleLeadMinutes: analytics.staleLeadMinutes,
      governancePending: stocks.governancePending,
      awaitingResponse: stocks.awaitingResponse,
      terminalResidualFollowUps: stocks.terminalResidualFollowUps,
      evidenceCoverage,
    },
    campaigns: campaignsOverview,
    pdvs: pdvsOverview,
  };
}

export type AnalyticsHealthDetailRow = {
  id: number;
  leadId: number;
  lead: string;
  campaign: string;
  pdv: string;
  responsible: string;
  occurredAt: Date | null;
  detail: string;
  evidenceCount: number | null;
  documentaryStatus: "Atendida" | "Pendente" | "Não exigida" | null;
};

/**
 * Drill-down provider for dashboard health. Each branch reads the same fact
 * table and predicate as its dashboard counter; rows are SQL-paginated and
 * scoped before they leave the backend.
 */
export async function listAnalyticsHealthDetails(
  context: PartnerContext,
  input: AnalyticsHealthDetailInput
) {
  const analytics = await createAnalyticsContext(context, input);
  const { db, scope, period, now } = analytics;
  const pagination = reportPagination(input);
  const responsibleMembership = alias(
    userPartners,
    "health_detail_responsible_membership"
  );
  const responsibleUser = alias(users, "health_detail_responsible_user");
  const leadConditions = scopeLeadConditions(context, scope, input);
  const fields = {
    leadId: leads.id,
    lead: leads.name,
    campaign: campaigns.name,
    pdv: pdvs.name,
    responsible: responsibleUser.name,
  };
  const joinLeadContext = (query: any) =>
    query
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leads.campaignId),
          eq(campaigns.partnerId, leads.partnerId)
        )
      )
      .innerJoin(
        pdvs,
        and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId))
      )
      .leftJoin(
        responsibleMembership,
        and(
          eq(responsibleMembership.id, leads.assignedMembershipId),
          eq(responsibleMembership.partnerId, leads.partnerId)
        )
      )
      .leftJoin(
        responsibleUser,
        eq(responsibleUser.id, responsibleMembership.userId)
      );
  const present = (rows: Array<any>, total: number) => ({
    kind: input.kind,
    rows: rows.map(row => ({
      id: Number(row.id),
      leadId: Number(row.leadId),
      lead: row.lead ?? "Lead sem nome",
      campaign: row.campaign,
      pdv: row.pdv,
      responsible: row.responsible ?? "Sem responsável",
      occurredAt: row.occurredAt ?? null,
      detail: row.detail ?? "",
      evidenceCount:
        row.evidenceCount == null ? null : numberOf(row.evidenceCount),
      documentaryStatus: row.documentaryStatus ?? null,
    })) as AnalyticsHealthDetailRow[],
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });

  if (
    input.kind === "evidence_eligible" ||
    input.kind === "evidence_with" ||
    input.kind === "evidence_without" ||
    input.kind === "evidence_required_pending"
  ) {
    const governance = alias(
      leadTreatmentGovernance,
      "health_detail_governance"
    );
    const evidenceCount = sql<number>`(select count(*) from ${leadEvidences} where ${leadEvidences.partnerId} = ${leadContacts.partnerId} and ${leadEvidences.leadId} = ${leadContacts.leadId} and ${leadEvidences.timelineEventId} = ${leadContacts.timelineEventId} and ${leadEvidences.deletedAt} is null and ${leadEvidences.storageStatus} = 'available')`;
    const required = sql<number>`coalesce(json_extract(${governance.appliedRuleJson}, '$.evidenceRequired'), false)`;
    const conditions: SQL[] = withPeriod(
      [
        ...leadConditions,
        eq(leadContacts.partnerId, context.partnerId),
        eq(leadContacts.recordKind, "effective_contact"),
      ],
      leadContacts.occurredAt,
      period
    );
    if (input.kind === "evidence_with")
      conditions.push(sql`${evidenceCount} > 0`);
    if (input.kind === "evidence_without")
      conditions.push(sql`${evidenceCount} = 0`);
    if (input.kind === "evidence_required_pending")
      conditions.push(sql`${required} and ${evidenceCount} = 0`);
    const base = db
      .select({
        id: leadContacts.id,
        ...fields,
        occurredAt: leadContacts.occurredAt,
        detail: leadContacts.resultLabel,
        evidenceCount,
        documentaryStatus: sql<
          "Atendida" | "Pendente" | "Não exigida"
        >`case when not ${required} then 'Não exigida' when ${evidenceCount} > 0 then 'Atendida' else 'Pendente' end`,
      })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .leftJoin(
        governance,
        and(
          eq(governance.partnerId, leadContacts.partnerId),
          eq(governance.leadId, leadContacts.leadId),
          eq(governance.timelineEventId, leadContacts.timelineEventId)
        )
      );
    const [rows, totals] = await Promise.all([
      joinLeadContext(base)
        .where(and(...conditions))
        .orderBy(desc(leadContacts.occurredAt), desc(leadContacts.id))
        .limit(pagination.pageSize)
        .offset(pagination.offset),
      db
        .select({ total: count() })
        .from(leadContacts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContacts.leadId),
            eq(leads.partnerId, leadContacts.partnerId)
          )
        )
        .leftJoin(
          governance,
          and(
            eq(governance.partnerId, leadContacts.partnerId),
            eq(governance.leadId, leadContacts.leadId),
            eq(governance.timelineEventId, leadContacts.timelineEventId)
          )
        )
        .where(and(...conditions)),
    ]);
    return present(rows, numberOf(totals[0]?.total));
  }

  if (
    input.kind === "attempt_evidence_eligible" ||
    input.kind === "attempt_evidence_with" ||
    input.kind === "attempt_evidence_without" ||
    input.kind === "attempt_evidence_required_pending"
  ) {
    const governance = alias(
      leadTreatmentGovernance,
      "health_detail_attempt_governance"
    );
    const evidenceCount = sql<number>`(select count(*) from ${leadEvidences} where ${leadEvidences.partnerId} = ${leadContactAttempts.partnerId} and ${leadEvidences.leadId} = ${leadContactAttempts.leadId} and ${leadEvidences.timelineEventId} = ${leadContactAttempts.timelineEventId} and ${leadEvidences.deletedAt} is null and ${leadEvidences.storageStatus} = 'available')`;
    const required = sql<number>`coalesce(json_extract(${governance.appliedRuleJson}, '$.evidenceRequired'), false)`;
    const conditions: SQL[] = withPeriod(
      [...leadConditions, eq(leadContactAttempts.partnerId, context.partnerId)],
      leadContactAttempts.occurredAt,
      period
    );
    if (input.kind === "attempt_evidence_with")
      conditions.push(sql`${evidenceCount} > 0`);
    if (input.kind === "attempt_evidence_without")
      conditions.push(sql`${evidenceCount} = 0`);
    if (input.kind === "attempt_evidence_required_pending")
      conditions.push(sql`${required} and ${evidenceCount} = 0`);
    const base = db
      .select({
        id: leadContactAttempts.id,
        ...fields,
        occurredAt: leadContactAttempts.occurredAt,
        detail: leadContactAttempts.resultLabel,
        evidenceCount,
        documentaryStatus: sql<
          "Atendida" | "Pendente" | "Não exigida"
        >`case when not ${required} then 'Não exigida' when ${evidenceCount} > 0 then 'Atendida' else 'Pendente' end`,
      })
      .from(leadContactAttempts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContactAttempts.leadId),
          eq(leads.partnerId, leadContactAttempts.partnerId)
        )
      )
      .leftJoin(
        governance,
        and(
          eq(governance.partnerId, leadContactAttempts.partnerId),
          eq(governance.leadId, leadContactAttempts.leadId),
          eq(governance.timelineEventId, leadContactAttempts.timelineEventId)
        )
      );
    const [rows, totals] = await Promise.all([
      joinLeadContext(base)
        .where(and(...conditions))
        .orderBy(
          desc(leadContactAttempts.occurredAt),
          desc(leadContactAttempts.id)
        )
        .limit(pagination.pageSize)
        .offset(pagination.offset),
      db
        .select({ total: count() })
        .from(leadContactAttempts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContactAttempts.leadId),
            eq(leads.partnerId, leadContactAttempts.partnerId)
          )
        )
        .leftJoin(
          governance,
          and(
            eq(governance.partnerId, leadContactAttempts.partnerId),
            eq(governance.leadId, leadContactAttempts.leadId),
            eq(governance.timelineEventId, leadContactAttempts.timelineEventId)
          )
        )
        .where(and(...conditions)),
    ]);
    return present(rows, numberOf(totals[0]?.total));
  }

  if (input.kind === "follow_ups_overdue") {
    const conditions: SQL[] = [
      ...leadConditions,
      eq(followUps.partnerId, context.partnerId),
      eq(followUps.status, "pending"),
      lt(followUps.dueAt, now),
    ];
    const base = db
      .select({
        id: followUps.id,
        ...fields,
        occurredAt: followUps.dueAt,
        detail: sql<string>`'Follow-up vencido'`,
        evidenceCount: sql<number | null>`null`,
        documentaryStatus: sql<null>`null`,
      })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      );
    const [rows, totals] = await Promise.all([
      joinLeadContext(base)
        .where(and(...conditions))
        .orderBy(asc(followUps.dueAt), asc(followUps.id))
        .limit(pagination.pageSize)
        .offset(pagination.offset),
      db
        .select({ total: count() })
        .from(followUps)
        .innerJoin(
          leads,
          and(
            eq(leads.id, followUps.leadId),
            eq(leads.partnerId, followUps.partnerId)
          )
        )
        .where(and(...conditions)),
    ]);
    return present(rows, numberOf(totals[0]?.total));
  }

  if (input.kind === "governance_pending") {
    const conditions: SQL[] = [
      ...leadConditions,
      eq(leadTreatmentGovernance.partnerId, context.partnerId),
      eq(leadTreatmentGovernance.isComplete, false),
      inArray(leadTreatmentGovernance.operationKind, [
        "attempt",
        "effective_contact",
      ]),
    ];
    const base = db
      .select({
        id: leadTreatmentGovernance.id,
        ...fields,
        occurredAt: leadTimelineEvents.occurredAt,
        detail: sql<string>`'Requisito documental ou operacional pendente'`,
        evidenceCount: sql<number | null>`null`,
        documentaryStatus: sql<null>`null`,
      })
      .from(leadTreatmentGovernance)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadTreatmentGovernance.leadId),
          eq(leads.partnerId, leadTreatmentGovernance.partnerId)
        )
      )
      .innerJoin(
        leadTimelineEvents,
        and(
          eq(leadTimelineEvents.id, leadTreatmentGovernance.timelineEventId),
          eq(leadTimelineEvents.partnerId, leadTreatmentGovernance.partnerId),
          eq(leadTimelineEvents.leadId, leadTreatmentGovernance.leadId)
        )
      );
    const [rows, totals] = await Promise.all([
      joinLeadContext(base)
        .where(and(...conditions))
        .orderBy(
          desc(leadTimelineEvents.occurredAt),
          desc(leadTreatmentGovernance.id)
        )
        .limit(pagination.pageSize)
        .offset(pagination.offset),
      db
        .select({ total: count() })
        .from(leadTreatmentGovernance)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadTreatmentGovernance.leadId),
            eq(leads.partnerId, leadTreatmentGovernance.partnerId)
          )
        )
        .where(and(...conditions)),
    ]);
    return present(rows, numberOf(totals[0]?.total));
  }

  const terminal = alias(leadStatuses, "health_detail_terminal_status");
  const conditions: SQL[] = [...leadConditions];
  let occurredAt: SQL<Date | null> | typeof leads.lastActivityAt =
    leads.lastActivityAt;
  let detail: SQL<string> = sql<string>`''`;
  if (input.kind === "unassigned") {
    conditions.push(
      isNull(leads.assignedMembershipId),
      eq(terminal.isTerminal, false)
    );
    detail = sql<string>`'Sem responsável atribuído'`;
  } else if (input.kind === "assigned_without_work") {
    conditions.push(
      isNotNull(leads.assignedMembershipId),
      isNull(leads.firstAttemptAt),
      isNull(leads.firstEffectiveContactAt),
      eq(terminal.isTerminal, false)
    );
    detail = sql<string>`'Ainda sem tentativa ou tratativa'`;
  } else if (input.kind === "awaiting_response") {
    conditions.push(
      eq(terminal.isTerminal, false),
      sql`exists (select 1 from ${leadContactAttempts} where ${leadContactAttempts.partnerId} = ${leads.partnerId} and ${leadContactAttempts.leadId} = ${leads.id} and ${leadContactAttempts.resultCategory} = 'awaiting_response')`
    );
    occurredAt = sql<Date | null>`(select max(${leadContactAttempts.occurredAt}) from ${leadContactAttempts} where ${leadContactAttempts.partnerId} = ${leads.partnerId} and ${leadContactAttempts.leadId} = ${leads.id} and ${leadContactAttempts.resultCategory} = 'awaiting_response')`;
    detail = sql<string>`'Aguardando resposta'`;
  } else if (input.kind === "terminal_residual_follow_ups") {
    conditions.push(
      eq(terminal.isTerminal, true),
      sql`exists (select 1 from ${followUps} where ${followUps.partnerId} = ${leads.partnerId} and ${followUps.leadId} = ${leads.id} and ${followUps.status} = 'pending')`
    );
    detail = sql<string>`'Follow-up pendente anterior à conclusão'`;
  }
  const base = db
    .select({
      id: leads.id,
      ...fields,
      occurredAt,
      detail,
      evidenceCount: sql<number | null>`null`,
      documentaryStatus: sql<null>`null`,
    })
    .from(leads)
    .innerJoin(terminal, eq(terminal.id, leads.statusId));
  const [rows, totals] = await Promise.all([
    joinLeadContext(base)
      .where(and(...conditions))
      .orderBy(desc(leads.lastActivityAt), desc(leads.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leads)
      .innerJoin(terminal, eq(terminal.id, leads.statusId))
      .where(and(...conditions)),
  ]);
  return present(rows, numberOf(totals[0]?.total));
}

async function listAnalyticsSellers(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters
): Promise<AnalyticsSeller[]> {
  const conditions: SQL[] = [
    eq(userPartners.partnerId, context.partnerId),
    eq(userPartners.role, "seller"),
    eq(userPartners.isActive, true),
    eq(users.isActive, true),
    eq(userPdvAssignments.partnerId, context.partnerId),
    eq(userPdvAssignments.isActive, true),
  ];
  if (scope.pdvIds)
    conditions.push(inArray(userPdvAssignments.pdvId, scope.pdvIds));
  if (filters.pdvId)
    conditions.push(eq(userPdvAssignments.pdvId, filters.pdvId));
  const requiredSeller = scope.ownMembershipId ?? filters.sellerMembershipId;
  if (requiredSeller) conditions.push(eq(userPartners.id, requiredSeller));
  const rows = await db
    .select({
      membershipId: userPartners.id,
      name: users.name,
      pdvId: userPdvAssignments.pdvId,
      pdvName: pdvs.name,
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
  const grouped = new Map<number, AnalyticsSeller>();
  for (const row of rows) {
    const existing = grouped.get(row.membershipId);
    if (existing) {
      if (!existing.pdvIds.includes(row.pdvId)) existing.pdvIds.push(row.pdvId);
      if (!existing.pdvNames.includes(row.pdvName))
        existing.pdvNames.push(row.pdvName);
    } else {
      grouped.set(row.membershipId, {
        membershipId: row.membershipId,
        name: row.name,
        pdvIds: [row.pdvId],
        pdvNames: [row.pdvName],
      });
    }
  }
  return Array.from(grouped.values());
}

type ProductivityRow = {
  membershipId: number;
  name: string;
  pdvIds: number[];
  pdvNames: string[];
  leadsInPortfolio: number;
  leadsAssignedInPeriod: number;
  leadsWorked: number;
  attempts: number;
  leadsWithAttempt: number;
  effectiveContacts: number;
  leadsWithEffectiveContact: number;
  interested: number;
  conversions: number;
  leadsConverted: number;
  followUpsCreated: number;
  followUpsCompleted: number;
  followUpsOverdue: number;
  followUpsPending: number;
  followUpsFromAttempts: number;
  followUpsFromTreatments: number;
  followUpsIndependent: number;
  firstAttemptAverageSeconds: number | null;
  firstEffectiveContactAverageSeconds: number | null;
  leadsWithoutWork: number;
  governanceComplete: number;
  governancePending: number;
  lastActivityAt: Date | null;
  effectiveContactRate: number | null;
  conversionRate: number | null;
  workCoverage: number | null;
  attemptsPerLead: number | null;
  followUpCompletionRate: number | null;
};

function blankProductivityRow(seller: AnalyticsSeller): ProductivityRow {
  return {
    ...seller,
    leadsInPortfolio: 0,
    leadsAssignedInPeriod: 0,
    leadsWorked: 0,
    attempts: 0,
    leadsWithAttempt: 0,
    effectiveContacts: 0,
    leadsWithEffectiveContact: 0,
    interested: 0,
    conversions: 0,
    leadsConverted: 0,
    followUpsCreated: 0,
    followUpsCompleted: 0,
    followUpsOverdue: 0,
    followUpsPending: 0,
    followUpsFromAttempts: 0,
    followUpsFromTreatments: 0,
    followUpsIndependent: 0,
    firstAttemptAverageSeconds: null,
    firstEffectiveContactAverageSeconds: null,
    leadsWithoutWork: 0,
    governanceComplete: 0,
    governancePending: 0,
    lastActivityAt: null,
    effectiveContactRate: null,
    conversionRate: null,
    workCoverage: null,
    attemptsPerLead: null,
    followUpCompletionRate: null,
  };
}

function mutateRows<T extends { membershipId: number }>(
  rows: T[],
  target: Map<number, ProductivityRow>,
  apply: (row: ProductivityRow, source: T) => void
) {
  for (const source of rows) {
    const row = target.get(source.membershipId);
    if (row) apply(row, source);
  }
}

type ProductivityDailyPoint = {
  date: string;
  leadsWorked: number;
  leadsWithAttempt: number;
  attempts: number;
  effectiveContacts: number;
  conversions: number;
  followUpsCompleted: number;
};

function averageSeconds(
  rows: Array<{ receivedAt: Date; occurredAt: Date }>
) {
  if (!rows.length) return null;
  return (
    rows.reduce(
      (total, row) =>
        total + (row.occurredAt.getTime() - row.receivedAt.getTime()) / 1_000,
      0
    ) / rows.length
  );
}

function partnerDateRange(period: AnalyticsPeriod, timeZone: string) {
  const first = dateForAnalyticsInput(period.start, timeZone);
  const last = dateForAnalyticsInput(
    new Date(period.end.getTime() - 1),
    timeZone
  );
  const cursor = new Date(`${first}T00:00:00.000Z`);
  const end = new Date(`${last}T00:00:00.000Z`);
  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Team-level productivity facts remain event-scoped to the visible sellers,
 * while Lead quantities are deduplicated across that team. This prevents the
 * summary from reporting a Lead twice when more than one seller worked it.
 */
async function queryProductivityTeamFacts(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  period: AnalyticsPeriod,
  sellerIds: number[]
) {
  const leadConditions = scopeLeadConditions(context, scope, filters, {
    includeOwner: false,
  });
  const [attempts, contacts, conversions, completedFollowUps, firstAttempts, firstContacts] =
    await Promise.all([
      db
        .select({
          leadId: leadContactAttempts.leadId,
          occurredAt: leadContactAttempts.occurredAt,
        })
        .from(leadContactAttempts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContactAttempts.leadId),
            eq(leads.partnerId, leadContactAttempts.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(leadContactAttempts.partnerId, context.partnerId),
            inArray(leadContactAttempts.actorMembershipId, sellerIds),
            gte(leadContactAttempts.occurredAt, period.start),
            lt(leadContactAttempts.occurredAt, period.end)
          )
        ),
      db
        .select({
          leadId: leadContacts.leadId,
          occurredAt: leadContacts.occurredAt,
        })
        .from(leadContacts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContacts.leadId),
            eq(leads.partnerId, leadContacts.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(leadContacts.partnerId, context.partnerId),
            inArray(leadContacts.actorMembershipId, sellerIds),
            eq(leadContacts.recordKind, "effective_contact"),
            gte(leadContacts.occurredAt, period.start),
            lt(leadContacts.occurredAt, period.end)
          )
        ),
      db
        .select({
          leadId: leadConversions.leadId,
          occurredAt: leadConversions.occurredAt,
        })
        .from(leadConversions)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadConversions.leadId),
            eq(leads.partnerId, leadConversions.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(leadConversions.partnerId, context.partnerId),
            inArray(leadConversions.actorMembershipId, sellerIds),
            gte(leadConversions.occurredAt, period.start),
            lt(leadConversions.occurredAt, period.end)
          )
        ),
      db
        .select({ completedAt: followUps.completedAt })
        .from(followUps)
        .innerJoin(
          leads,
          and(
            eq(leads.id, followUps.leadId),
            eq(leads.partnerId, followUps.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(followUps.partnerId, context.partnerId),
            inArray(followUps.ownerMembershipId, sellerIds),
            isNotNull(followUps.completedAt),
            gte(followUps.completedAt, period.start),
            lt(followUps.completedAt, period.end)
          )
        ),
      db
        .select({
          receivedAt: leads.receivedAt,
          occurredAt: leadContactAttempts.occurredAt,
        })
        .from(leadContactAttempts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContactAttempts.leadId),
            eq(leads.partnerId, leadContactAttempts.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(leadContactAttempts.partnerId, context.partnerId),
            inArray(leadContactAttempts.actorMembershipId, sellerIds),
            eq(leadContactAttempts.occurredAt, leads.firstAttemptAt),
            gte(leadContactAttempts.occurredAt, period.start),
            lt(leadContactAttempts.occurredAt, period.end)
          )
        ),
      db
        .select({
          receivedAt: leads.receivedAt,
          occurredAt: leadContacts.occurredAt,
        })
        .from(leadContacts)
        .innerJoin(
          leads,
          and(
            eq(leads.id, leadContacts.leadId),
            eq(leads.partnerId, leadContacts.partnerId)
          )
        )
        .where(
          and(
            ...leadConditions,
            eq(leadContacts.partnerId, context.partnerId),
            inArray(leadContacts.actorMembershipId, sellerIds),
            eq(leadContacts.recordKind, "effective_contact"),
            eq(leadContacts.occurredAt, leads.firstEffectiveContactAt),
            gte(leadContacts.occurredAt, period.start),
            lt(leadContacts.occurredAt, period.end)
          )
        ),
    ]);

  const points = new Map<string, ProductivityDailyPoint>();
  for (const date of partnerDateRange(period, period.timeZone)) {
    points.set(date, {
      date,
      leadsWorked: 0,
      leadsWithAttempt: 0,
      attempts: 0,
      effectiveContacts: 0,
      conversions: 0,
      followUpsCompleted: 0,
    });
  }
  const attemptedByDay = new Map<string, Set<number>>();
  const workedByDay = new Map<string, Set<number>>();
  const pointFor = (occurredAt: Date) =>
    points.get(dateForAnalyticsInput(occurredAt, period.timeZone));
  const addLead = (index: Map<string, Set<number>>, date: string, leadId: number) => {
    const leadsForDate = index.get(date) ?? new Set<number>();
    leadsForDate.add(leadId);
    index.set(date, leadsForDate);
  };
  for (const row of attempts) {
    const date = dateForAnalyticsInput(row.occurredAt, period.timeZone);
    const point = pointFor(row.occurredAt);
    if (!point) continue;
    point.attempts += 1;
    addLead(attemptedByDay, date, Number(row.leadId));
    addLead(workedByDay, date, Number(row.leadId));
  }
  for (const row of contacts) {
    const date = dateForAnalyticsInput(row.occurredAt, period.timeZone);
    const point = pointFor(row.occurredAt);
    if (!point) continue;
    point.effectiveContacts += 1;
    addLead(workedByDay, date, Number(row.leadId));
  }
  for (const row of conversions) {
    const point = pointFor(row.occurredAt);
    if (point) point.conversions += 1;
  }
  for (const row of completedFollowUps) {
    const point = row.completedAt ? pointFor(row.completedAt) : undefined;
    if (point) point.followUpsCompleted += 1;
  }
  for (const [date, point] of Array.from(points.entries())) {
    point.leadsWithAttempt = attemptedByDay.get(date)?.size ?? 0;
    point.leadsWorked = workedByDay.get(date)?.size ?? 0;
  }

  const attemptedLeadIds = new Set(attempts.map(row => Number(row.leadId)));
  const contactedLeadIds = new Set(contacts.map(row => Number(row.leadId)));
  const convertedLeadIds = new Set(conversions.map(row => Number(row.leadId)));
  const workedLeadIds = new Set([
    ...Array.from(attemptedLeadIds),
    ...Array.from(contactedLeadIds),
  ]);
  return {
    daily: Array.from(points.values()),
    leadsWorked: workedLeadIds.size,
    leadsWithAttempt: attemptedLeadIds.size,
    attempts: attempts.length,
    leadsWithEffectiveContact: contactedLeadIds.size,
    effectiveContacts: contacts.length,
    leadsConverted: convertedLeadIds.size,
    conversions: conversions.length,
    followUpsCompleted: completedFollowUps.length,
    firstAttemptAverageSeconds: averageSeconds(firstAttempts),
    firstEffectiveContactAverageSeconds: averageSeconds(firstContacts),
  };
}

/** Per-seller SQL aggregation for effort, quality and commercial outcome. */
export async function getProductivityAnalytics(
  context: PartnerContext,
  filters: AnalyticsFilters
) {
  const analytics = await createAnalyticsContext(context, filters);
  const { db, scope, period, now } = analytics;
  const sellers = await listAnalyticsSellers(db, context, scope, filters);
  const bySeller = new Map(
    sellers.map(seller => [seller.membershipId, blankProductivityRow(seller)])
  );
  if (!sellers.length) {
    return {
      period: {
        start: period.start,
        end: period.end,
        timeZone: period.timeZone,
        label: period.label,
      },
      totals: {
        sellers: 0,
        portfolio: 0,
        attempts: 0,
        leadsWithAttempt: 0,
        attemptsPerLead: null,
        effectiveContacts: 0,
        leadsWithEffectiveContact: 0,
        worked: 0,
        workCoverage: null,
        effectiveContactRate: null,
        conversions: 0,
        leadsConverted: 0,
        conversionRate: null,
        firstAttemptAverageSeconds: null,
        firstEffectiveContactAverageSeconds: null,
        followUpsOverdue: 0,
        followUpsCompleted: 0,
      },
      sellers: [] as ProductivityRow[],
      daily: [] as ProductivityDailyPoint[],
    };
  }
  const sellerIds = sellers.map(seller => seller.membershipId);
  const leadConditions = scopeLeadConditions(context, scope, filters, {
    includeOwner: false,
  });
  const event = alias(leadTimelineEvents, "productivity_operation_event");
  const origin = alias(leadTimelineEvents, "productivity_follow_up_origin");
  const [
    portfolioRows,
    attemptRows,
    contactRows,
    workedRows,
    conversionRows,
    followUpRows,
    governanceRows,
    attemptTimeRows,
    contactTimeRows,
    activityRows,
  ] = await Promise.all([
    db
      .select({
        membershipId: leads.assignedMembershipId,
        portfolio: countDistinct(leads.id),
        assigned: sql<number>`coalesce(sum(case when ${leads.assignedAt} >= ${period.start} and ${leads.assignedAt} < ${period.end} then 1 else 0 end), 0)`,
        withoutWork: sql<number>`coalesce(sum(case when ${leads.firstAttemptAt} is null and ${leads.firstEffectiveContactAt} is null then 1 else 0 end), 0)`,
      })
      .from(leads)
      .where(
        and(...leadConditions, inArray(leads.assignedMembershipId, sellerIds))
      )
      .groupBy(leads.assignedMembershipId),
    db
      .select({
        membershipId: leadContactAttempts.actorMembershipId,
        attempts: count(),
        leads: countDistinct(leadContactAttempts.leadId),
      })
      .from(leadContactAttempts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContactAttempts.leadId),
          eq(leads.partnerId, leadContactAttempts.partnerId)
        )
      )
      .where(
        and(
          ...leadConditions,
          eq(leadContactAttempts.partnerId, context.partnerId),
          inArray(leadContactAttempts.actorMembershipId, sellerIds),
          gte(leadContactAttempts.occurredAt, period.start),
          lt(leadContactAttempts.occurredAt, period.end)
        )
      )
      .groupBy(leadContactAttempts.actorMembershipId),
    db
      .select({
        membershipId: leadContacts.actorMembershipId,
        contacts: count(),
        leads: countDistinct(leadContacts.leadId),
        interested: sql<number>`coalesce(count(distinct case when ${leadContacts.resultCategory} = 'interested' then ${leadContacts.leadId} end), 0)`,
      })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .where(
        and(
          ...leadConditions,
          eq(leadContacts.partnerId, context.partnerId),
          inArray(leadContacts.actorMembershipId, sellerIds),
          eq(leadContacts.recordKind, "effective_contact"),
          gte(leadContacts.occurredAt, period.start),
          lt(leadContacts.occurredAt, period.end)
        )
      )
      .groupBy(leadContacts.actorMembershipId),
    db
      .select({
        membershipId: event.actorMembershipId,
        worked: countDistinct(event.leadId),
      })
      .from(event)
      .innerJoin(
        leads,
        and(eq(leads.id, event.leadId), eq(leads.partnerId, event.partnerId))
      )
      .where(
        and(
          ...leadConditions,
          eq(event.partnerId, context.partnerId),
          inArray(event.actorMembershipId, sellerIds),
          inArray(event.type, [...OPERATION_EVENT_TYPES]),
          gte(event.occurredAt, period.start),
          lt(event.occurredAt, period.end)
        )
      )
      .groupBy(event.actorMembershipId),
    db
      .select({
        membershipId: leadConversions.actorMembershipId,
        conversions: count(),
        leads: countDistinct(leadConversions.leadId),
      })
      .from(leadConversions)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadConversions.leadId),
          eq(leads.partnerId, leadConversions.partnerId)
        )
      )
      .where(
        and(
          ...leadConditions,
          eq(leadConversions.partnerId, context.partnerId),
          inArray(leadConversions.actorMembershipId, sellerIds),
          gte(leadConversions.occurredAt, period.start),
          lt(leadConversions.occurredAt, period.end)
        )
      )
      .groupBy(leadConversions.actorMembershipId),
    db
      .select({
        membershipId: followUps.ownerMembershipId,
        created: sql<number>`coalesce(sum(case when ${followUps.createdAt} >= ${period.start} and ${followUps.createdAt} < ${period.end} then 1 else 0 end), 0)`,
        completed: sql<number>`coalesce(sum(case when ${followUps.completedAt} >= ${period.start} and ${followUps.completedAt} < ${period.end} then 1 else 0 end), 0)`,
        overdue: sql<number>`coalesce(sum(case when ${followUps.status} = 'pending' and ${followUps.dueAt} < ${now} then 1 else 0 end), 0)`,
        pending: sql<number>`coalesce(sum(case when ${followUps.status} = 'pending' then 1 else 0 end), 0)`,
        attemptOrigin: sql<number>`coalesce(sum(case when ${origin.type} = 'contact_attempted' then 1 else 0 end), 0)`,
        treatmentOrigin: sql<number>`coalesce(sum(case when ${origin.type} = 'effective_contact_recorded' then 1 else 0 end), 0)`,
        independentOrigin: sql<number>`coalesce(sum(case when ${followUps.originTimelineEventId} is null then 1 else 0 end), 0)`,
      })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .leftJoin(
        origin,
        and(
          eq(origin.id, followUps.originTimelineEventId),
          eq(origin.partnerId, followUps.partnerId),
          eq(origin.leadId, followUps.leadId)
        )
      )
      .where(
        and(
          ...leadConditions,
          eq(followUps.partnerId, context.partnerId),
          inArray(followUps.ownerMembershipId, sellerIds)
        )
      )
      .groupBy(followUps.ownerMembershipId),
    db
      .select({
        membershipId: event.actorMembershipId,
        complete: sql<number>`coalesce(sum(case when ${leadTreatmentGovernance.isComplete} = true then 1 else 0 end), 0)`,
        pending: sql<number>`coalesce(sum(case when ${leadTreatmentGovernance.isComplete} = false then 1 else 0 end), 0)`,
      })
      .from(leadTreatmentGovernance)
      .innerJoin(
        event,
        and(
          eq(event.id, leadTreatmentGovernance.timelineEventId),
          eq(event.partnerId, leadTreatmentGovernance.partnerId),
          eq(event.leadId, leadTreatmentGovernance.leadId)
        )
      )
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadTreatmentGovernance.leadId),
          eq(leads.partnerId, leadTreatmentGovernance.partnerId)
        )
      )
      .where(
        and(
          ...leadConditions,
          eq(leadTreatmentGovernance.partnerId, context.partnerId),
          inArray(event.actorMembershipId, sellerIds),
          inArray(leadTreatmentGovernance.operationKind, [
            "attempt",
            "effective_contact",
          ])
        )
      )
      .groupBy(event.actorMembershipId),
    db
      .select({
        membershipId: leadContactAttempts.actorMembershipId,
        seconds: sql<
          number | null
        >`avg(timestampdiff(second, ${leads.receivedAt}, ${leadContactAttempts.occurredAt}))`,
      })
      .from(leadContactAttempts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContactAttempts.leadId),
          eq(leads.partnerId, leadContactAttempts.partnerId)
        )
      )
      .where(
        and(
          ...leadConditions,
          eq(leadContactAttempts.partnerId, context.partnerId),
          inArray(leadContactAttempts.actorMembershipId, sellerIds),
          eq(leadContactAttempts.occurredAt, leads.firstAttemptAt),
          gte(leadContactAttempts.occurredAt, period.start),
          lt(leadContactAttempts.occurredAt, period.end)
        )
      )
      .groupBy(leadContactAttempts.actorMembershipId),
    db
      .select({
        membershipId: leadContacts.actorMembershipId,
        seconds: sql<
          number | null
        >`avg(timestampdiff(second, ${leads.receivedAt}, ${leadContacts.occurredAt}))`,
      })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .where(
        and(
          ...leadConditions,
          eq(leadContacts.partnerId, context.partnerId),
          inArray(leadContacts.actorMembershipId, sellerIds),
          eq(leadContacts.recordKind, "effective_contact"),
          eq(leadContacts.occurredAt, leads.firstEffectiveContactAt),
          gte(leadContacts.occurredAt, period.start),
          lt(leadContacts.occurredAt, period.end)
        )
      )
      .groupBy(leadContacts.actorMembershipId),
    db
      .select({
        membershipId: event.actorMembershipId,
        lastActivityAt: max(event.occurredAt),
      })
      .from(event)
      .innerJoin(
        leads,
        and(eq(leads.id, event.leadId), eq(leads.partnerId, event.partnerId))
      )
      .where(
        and(
          ...leadConditions,
          eq(event.partnerId, context.partnerId),
          inArray(event.actorMembershipId, sellerIds),
          inArray(event.type, [...OPERATION_EVENT_TYPES]),
          gte(event.occurredAt, period.start),
          lt(event.occurredAt, period.end)
        )
      )
      .groupBy(event.actorMembershipId),
  ]);
  mutateRows(
    portfolioRows.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.leadsInPortfolio = numberOf(row.portfolio);
      target.leadsAssignedInPeriod = numberOf(row.assigned);
      target.leadsWithoutWork = numberOf(row.withoutWork);
    }
  );
  mutateRows(attemptRows, bySeller, (target, row) => {
    target.attempts = numberOf(row.attempts);
    target.leadsWithAttempt = numberOf(row.leads);
  });
  mutateRows(contactRows, bySeller, (target, row) => {
    target.effectiveContacts = numberOf(row.contacts);
    target.leadsWithEffectiveContact = numberOf(row.leads);
    target.interested = numberOf(row.interested);
  });
  mutateRows(
    workedRows.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.leadsWorked = numberOf(row.worked);
    }
  );
  mutateRows(conversionRows, bySeller, (target, row) => {
    target.conversions = numberOf(row.conversions);
    target.leadsConverted = numberOf(row.leads);
  });
  mutateRows(followUpRows, bySeller, (target, row) => {
    target.followUpsCreated = numberOf(row.created);
    target.followUpsCompleted = numberOf(row.completed);
    target.followUpsOverdue = numberOf(row.overdue);
    target.followUpsPending = numberOf(row.pending);
    target.followUpsFromAttempts = numberOf(row.attemptOrigin);
    target.followUpsFromTreatments = numberOf(row.treatmentOrigin);
    target.followUpsIndependent = numberOf(row.independentOrigin);
  });
  mutateRows(
    governanceRows.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.governanceComplete = numberOf(row.complete);
      target.governancePending = numberOf(row.pending);
    }
  );
  mutateRows(attemptTimeRows, bySeller, (target, row) => {
    target.firstAttemptAverageSeconds =
      row.seconds == null ? null : numberOf(row.seconds);
  });
  mutateRows(contactTimeRows, bySeller, (target, row) => {
    target.firstEffectiveContactAverageSeconds =
      row.seconds == null ? null : numberOf(row.seconds);
  });
  mutateRows(
    activityRows.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.lastActivityAt = row.lastActivityAt;
    }
  );
  const rows = Array.from(bySeller.values()).map(row => ({
    ...row,
    effectiveContactRate: safeRate(
      row.leadsWithEffectiveContact,
      row.leadsWorked
    ),
    conversionRate: safeRate(
      row.leadsConverted,
      row.leadsWithEffectiveContact
    ),
    workCoverage: safeRate(row.leadsWorked, row.leadsInPortfolio),
    attemptsPerLead: safeRate(row.attempts, row.leadsWithAttempt),
    followUpCompletionRate: safeRate(
      row.followUpsCompleted,
      row.followUpsCompleted + row.followUpsPending
    ),
  }));
  const teamFacts = await queryProductivityTeamFacts(
    db,
    context,
    scope,
    filters,
    period,
    sellerIds
  );
  const teamPortfolio = rows.reduce(
    (total, row) => total + row.leadsInPortfolio,
    0
  );
  return {
    period: {
      start: period.start,
      end: period.end,
      timeZone: period.timeZone,
      label: period.label,
    },
    totals: {
      sellers: rows.length,
      portfolio: teamPortfolio,
      attempts: teamFacts.attempts,
      leadsWithAttempt: teamFacts.leadsWithAttempt,
      attemptsPerLead: safeRate(teamFacts.attempts, teamFacts.leadsWithAttempt),
      effectiveContacts: teamFacts.effectiveContacts,
      leadsWithEffectiveContact: teamFacts.leadsWithEffectiveContact,
      worked: teamFacts.leadsWorked,
      workCoverage: safeRate(teamFacts.leadsWorked, teamPortfolio),
      effectiveContactRate: safeRate(
        teamFacts.leadsWithEffectiveContact,
        teamFacts.leadsWorked
      ),
      conversions: teamFacts.conversions,
      leadsConverted: teamFacts.leadsConverted,
      conversionRate: safeRate(
        teamFacts.leadsConverted,
        teamFacts.leadsWithEffectiveContact
      ),
      firstAttemptAverageSeconds: teamFacts.firstAttemptAverageSeconds,
      firstEffectiveContactAverageSeconds:
        teamFacts.firstEffectiveContactAverageSeconds,
      followUpsOverdue: rows.reduce(
        (total, row) => total + row.followUpsOverdue,
        0
      ),
      followUpsCompleted: teamFacts.followUpsCompleted,
    },
    sellers: rows,
    daily: teamFacts.daily,
  };
}

export async function listAnalyticsFilters(context: PartnerContext) {
  const analytics = await createAnalyticsContext(context, {});
  const { db, scope, period } = analytics;
  const campaignConditions: SQL[] = [
    eq(campaigns.partnerId, context.partnerId),
  ];
  const pdvConditions: SQL[] = [eq(pdvs.partnerId, context.partnerId)];
  if (scope.pdvIds) {
    campaignConditions.push(inArray(campaignPdvs.pdvId, scope.pdvIds));
    pdvConditions.push(inArray(pdvs.id, scope.pdvIds));
  }
  const [campaignRows, pdvRows, sellers] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
      })
      .from(campaigns)
      .innerJoin(
        campaignPdvs,
        and(
          eq(campaignPdvs.campaignId, campaigns.id),
          eq(campaignPdvs.partnerId, campaigns.partnerId)
        )
      )
      .where(and(...campaignConditions))
      .orderBy(asc(campaigns.name)),
    db
      .select({ id: pdvs.id, name: pdvs.name, isActive: pdvs.isActive })
      .from(pdvs)
      .where(and(...pdvConditions))
      .orderBy(asc(pdvs.name)),
    listAnalyticsSellers(db, context, scope, {}),
  ]);
  return {
    timeZone: period.timeZone,
    campaigns: Array.from(
      new Map(campaignRows.map(row => [row.id, row])).values()
    ),
    pdvs: pdvRows,
    sellers: sellers.map(seller => ({
      id: seller.membershipId,
      name: seller.name,
      pdvIds: seller.pdvIds,
    })),
    periods: [
      "today",
      "yesterday",
      "last_7_days",
      "this_week",
      "this_month",
      "custom",
    ] as AnalyticsPeriodPreset[],
  };
}

function reportPagination(
  input: Pick<AnalyticsReportInput, "page" | "pageSize">,
  maximum = REPORT_PAGE_MAX
) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(Math.max(1, input.pageSize), maximum);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function customFieldValue(value: unknown): string | number | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => String(item)).join(", ");
  return JSON.stringify(value);
}

function leadReportColumns(
  customFields: Array<{ key: string; label: string }>
): AnalyticsReportColumn[] {
  return [
    { key: "id", label: "Identificador" },
    { key: "campaign", label: "Campanha" },
    { key: "pdv", label: "PDV" },
    { key: "responsible", label: "Responsável" },
    { key: "name", label: "Lead" },
    { key: "phone", label: "Telefone" },
    { key: "email", label: "E-mail" },
    { key: "status", label: "Situação atual" },
    { key: "receivedAt", label: "Recebido em" },
    { key: "firstAttemptAt", label: "Primeira tentativa" },
    { key: "firstEffectiveContactAt", label: "Primeiro contato efetivo" },
    { key: "nextFollowUpAt", label: "Próximo follow-up" },
    { key: "attempts", label: "Tentativas" },
    { key: "effectiveContacts", label: "Tratativas" },
    { key: "hasEvidence", label: "Possui alguma evidência" },
    { key: "evidenceCount", label: "Evidências disponíveis" },
    { key: "eligibleTreatments", label: "Tratativas elegíveis" },
    { key: "treatmentsWithEvidence", label: "Tratativas com evidência" },
    { key: "evidenceCoverage", label: "Cobertura de evidências" },
    {
      key: "requiredEvidencePending",
      label: "Possui pendência obrigatória",
    },
    { key: "hasConversion", label: "Possui conversão" },
    { key: "conversionAt", label: "Data da conversão" },
    ...customFields.map(field => ({
      key: `custom_${field.key}`,
      label: field.label,
    })),
  ];
}

/**
 * TiDB does not plan the correlated aggregate subqueries that used to enrich
 * each lead row reliably. Keep the facts SQL-side, but aggregate them once per
 * scoped lead and join those derived facts into the paginated report.
 *
 * The report cohort is deliberately repeated inside every derived query. This
 * preserves the resolved tenant, PDV and seller scope instead of materialising
 * unrestricted partner facts in the application process.
 */
function createLeadReportFacts(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  input: AnalyticsReportInput,
  period: Pick<AnalyticsPeriod, "start" | "end">
) {
  const reportLeadConditions = [
    ...scopeLeadConditions(context, scope, input),
    gte(leads.receivedAt, period.start),
    lt(leads.receivedAt, period.end),
  ];
  const availableEvidenceByEvent = db
    .select({
      partnerId: leadEvidences.partnerId,
      leadId: leadEvidences.leadId,
      timelineEventId: leadEvidences.timelineEventId,
      evidenceCount: count().as("evidenceCount"),
    })
    .from(leadEvidences)
    .innerJoin(
      leads,
      and(
        eq(leads.id, leadEvidences.leadId),
        eq(leads.partnerId, leadEvidences.partnerId)
      )
    )
    .where(
      and(
        ...reportLeadConditions,
        eq(leadEvidences.partnerId, context.partnerId),
        isNull(leadEvidences.deletedAt),
        eq(leadEvidences.storageStatus, "available")
      )
    )
    .groupBy(
      leadEvidences.partnerId,
      leadEvidences.leadId,
      leadEvidences.timelineEventId
    )
    .as("report_lead_available_evidence_by_event");
  const evidenceByLead = db
    .select({
      partnerId: leadEvidences.partnerId,
      leadId: leadEvidences.leadId,
      evidenceCount: count().as("evidenceCount"),
    })
    .from(leadEvidences)
    .innerJoin(
      leads,
      and(
        eq(leads.id, leadEvidences.leadId),
        eq(leads.partnerId, leadEvidences.partnerId)
      )
    )
    .where(
      and(
        ...reportLeadConditions,
        eq(leadEvidences.partnerId, context.partnerId),
        isNull(leadEvidences.deletedAt),
        eq(leadEvidences.storageStatus, "available")
      )
    )
    .groupBy(leadEvidences.partnerId, leadEvidences.leadId)
    .as("report_lead_available_evidence");
  const attempts = db
    .select({
      partnerId: leadContactAttempts.partnerId,
      leadId: leadContactAttempts.leadId,
      attempts: count().as("attempts"),
    })
    .from(leadContactAttempts)
    .innerJoin(
      leads,
      and(
        eq(leads.id, leadContactAttempts.leadId),
        eq(leads.partnerId, leadContactAttempts.partnerId)
      )
    )
    .where(
      and(
        ...reportLeadConditions,
        eq(leadContactAttempts.partnerId, context.partnerId)
      )
    )
    .groupBy(leadContactAttempts.partnerId, leadContactAttempts.leadId)
    .as("report_lead_attempt_stats");
  const treatments = db
    .select({
      partnerId: leadContacts.partnerId,
      leadId: leadContacts.leadId,
      eligibleTreatments: count().as("eligibleTreatments"),
      treatmentsWithEvidence:
        sql<number>`count(case when ${availableEvidenceByEvent.timelineEventId} is not null then 1 end)`.as(
          "treatmentsWithEvidence"
        ),
      requiredEvidencePending:
        sql<number>`count(case when coalesce(json_extract(${leadTreatmentGovernance.appliedRuleJson}, '$.evidenceRequired'), false) and ${availableEvidenceByEvent.timelineEventId} is null then 1 end)`.as(
          "requiredEvidencePending"
        ),
    })
    .from(leadContacts)
    .innerJoin(
      leads,
      and(
        eq(leads.id, leadContacts.leadId),
        eq(leads.partnerId, leadContacts.partnerId)
      )
    )
    .leftJoin(
      leadTreatmentGovernance,
      and(
        eq(leadTreatmentGovernance.partnerId, leadContacts.partnerId),
        eq(leadTreatmentGovernance.leadId, leadContacts.leadId),
        eq(
          leadTreatmentGovernance.timelineEventId,
          leadContacts.timelineEventId
        )
      )
    )
    .leftJoin(
      availableEvidenceByEvent,
      and(
        eq(availableEvidenceByEvent.partnerId, leadContacts.partnerId),
        eq(availableEvidenceByEvent.leadId, leadContacts.leadId),
        eq(
          availableEvidenceByEvent.timelineEventId,
          leadContacts.timelineEventId
        )
      )
    )
    .where(
      and(
        ...reportLeadConditions,
        eq(leadContacts.partnerId, context.partnerId),
        eq(leadContacts.recordKind, "effective_contact")
      )
    )
    .groupBy(leadContacts.partnerId, leadContacts.leadId)
    .as("report_lead_treatment_stats");
  const conversions = db
    .select({
      partnerId: leadConversions.partnerId,
      leadId: leadConversions.leadId,
      conversionAt: min(leadConversions.occurredAt).as("conversionAt"),
    })
    .from(leadConversions)
    .innerJoin(
      leads,
      and(
        eq(leads.id, leadConversions.leadId),
        eq(leads.partnerId, leadConversions.partnerId)
      )
    )
    .where(
      and(
        ...reportLeadConditions,
        eq(leadConversions.partnerId, context.partnerId)
      )
    )
    .groupBy(leadConversions.partnerId, leadConversions.leadId)
    .as("report_lead_conversion_stats");
  return { attempts, conversions, evidenceByLead, treatments };
}

/** Aggregate attachment facts before joining operational event reports. */
function createAvailableEvidenceByEvent(
  db: V2Database,
  context: PartnerContext,
  name: string
) {
  return db
    .select({
      partnerId: leadEvidences.partnerId,
      leadId: leadEvidences.leadId,
      timelineEventId: leadEvidences.timelineEventId,
      evidenceCount: count().as("evidenceCount"),
    })
    .from(leadEvidences)
    .where(
      and(
        eq(leadEvidences.partnerId, context.partnerId),
        isNull(leadEvidences.deletedAt),
        eq(leadEvidences.storageStatus, "available")
      )
    )
    .groupBy(
      leadEvidences.partnerId,
      leadEvidences.leadId,
      leadEvidences.timelineEventId
    )
    .as(name);
}

/** A follow-up can be attached to an attempt or treatment timeline event. */
function createFollowUpsByOriginEvent(
  db: V2Database,
  context: PartnerContext,
  name: string
) {
  return db
    .select({
      partnerId: followUps.partnerId,
      leadId: followUps.leadId,
      timelineEventId: followUps.originTimelineEventId,
      followUpCount: count().as("followUpCount"),
    })
    .from(followUps)
    .where(
      and(
        eq(followUps.partnerId, context.partnerId),
        isNotNull(followUps.originTimelineEventId)
      )
    )
    .groupBy(
      followUps.partnerId,
      followUps.leadId,
      followUps.originTimelineEventId
    )
    .as(name);
}

/** Last operational interaction is an aggregate fact, never a row-by-row lookup. */
function createLastOperationalInteractionByLead(
  db: V2Database,
  context: PartnerContext
) {
  return db
    .select({
      partnerId: leadTimelineEvents.partnerId,
      leadId: leadTimelineEvents.leadId,
      lastInteractionAt: max(leadTimelineEvents.occurredAt).as(
        "lastInteractionAt"
      ),
    })
    .from(leadTimelineEvents)
    .where(
      and(
        eq(leadTimelineEvents.partnerId, context.partnerId),
        inArray(leadTimelineEvents.type, [...OPERATION_EVENT_TYPES])
      )
    )
    .groupBy(leadTimelineEvents.partnerId, leadTimelineEvents.leadId)
    .as("report_last_operational_interaction");
}

/** Preserve the per-conversion reopen semantics without a correlated EXISTS. */
function createReopenedConversionFacts(
  db: V2Database,
  context: PartnerContext
) {
  const reopenedEvent = alias(
    leadTimelineEvents,
    "report_conversion_reopened_event"
  );
  return db
    .select({
      partnerId: leadConversions.partnerId,
      conversionId: leadConversions.id,
      reopened:
        sql<number>`max(case when ${reopenedEvent.id} is null then 0 else 1 end)`.as(
          "reopened"
        ),
    })
    .from(leadConversions)
    .leftJoin(
      reopenedEvent,
      and(
        eq(reopenedEvent.partnerId, leadConversions.partnerId),
        eq(reopenedEvent.leadId, leadConversions.leadId),
        eq(reopenedEvent.type, "lead_reopened"),
        gt(reopenedEvent.occurredAt, leadConversions.occurredAt)
      )
    )
    .where(eq(leadConversions.partnerId, context.partnerId))
    .groupBy(leadConversions.partnerId, leadConversions.id)
    .as("report_conversion_reopened");
}

async function listLeadsReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  const facts = createLeadReportFacts(db, context, scope, input, period);
  const evidenceCount = sql<number>`coalesce(${facts.evidenceByLead.evidenceCount}, 0)`;
  const eligibleTreatments = sql<number>`coalesce(${facts.treatments.eligibleTreatments}, 0)`;
  const treatmentsWithEvidence = sql<number>`coalesce(${facts.treatments.treatmentsWithEvidence}, 0)`;
  const requiredEvidencePending = sql<number>`coalesce(${facts.treatments.requiredEvidencePending}, 0)`;
  const conditions: SQL[] = [
    ...scopeLeadConditions(context, scope, input),
    gte(leads.receivedAt, period.start),
    lt(leads.receivedAt, period.end),
  ];
  if (input.evidenceFilter === "with_evidence")
    conditions.push(sql`${evidenceCount} > 0`);
  if (input.evidenceFilter === "without_evidence")
    conditions.push(
      sql`${eligibleTreatments} > 0 and ${treatmentsWithEvidence} = 0`
    );
  if (input.evidenceFilter === "required_pending")
    conditions.push(sql`${requiredEvidencePending} > 0`);
  const responsibleMembership = alias(
    userPartners,
    "report_lead_responsible_membership"
  );
  const responsibleUser = alias(users, "report_lead_responsible_user");
  const [customFields, records, totals] = await Promise.all([
    db
      .select({
        key: customFieldDefinitions.key,
        label: customFieldDefinitions.label,
      })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.partnerId, context.partnerId),
          eq(customFieldDefinitions.entityType, "lead"),
          eq(customFieldDefinitions.isActive, true)
        )
      )
      .orderBy(
        asc(customFieldDefinitions.sortOrder),
        asc(customFieldDefinitions.key)
      ),
    db
      .select({
        id: leads.id,
        campaign: campaigns.name,
        pdv: pdvs.name,
        responsible: responsibleUser.name,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        status: leadStatuses.label,
        receivedAt: leads.receivedAt,
        firstAttemptAt: leads.firstAttemptAt,
        firstEffectiveContactAt: leads.firstEffectiveContactAt,
        nextFollowUpAt: leads.nextFollowUpAt,
        customData: leads.customData,
        attempts: sql<number>`coalesce(${facts.attempts.attempts}, 0)`,
        effectiveContacts: eligibleTreatments,
        evidenceCount,
        eligibleTreatments,
        treatmentsWithEvidence,
        requiredEvidencePending,
        conversionAt: facts.conversions.conversionAt,
      })
      .from(leads)
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leads.campaignId),
          eq(campaigns.partnerId, leads.partnerId)
        )
      )
      .innerJoin(
        pdvs,
        and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId))
      )
      .innerJoin(
        leadStatuses,
        and(
          eq(leadStatuses.id, leads.statusId),
          eq(leadStatuses.partnerId, leads.partnerId)
        )
      )
      .leftJoin(
        responsibleMembership,
        and(
          eq(responsibleMembership.id, leads.assignedMembershipId),
          eq(responsibleMembership.partnerId, leads.partnerId)
        )
      )
      .leftJoin(
        responsibleUser,
        eq(responsibleUser.id, responsibleMembership.userId)
      )
      .leftJoin(
        facts.attempts,
        and(
          eq(facts.attempts.partnerId, leads.partnerId),
          eq(facts.attempts.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.treatments,
        and(
          eq(facts.treatments.partnerId, leads.partnerId),
          eq(facts.treatments.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.evidenceByLead,
        and(
          eq(facts.evidenceByLead.partnerId, leads.partnerId),
          eq(facts.evidenceByLead.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.conversions,
        and(
          eq(facts.conversions.partnerId, leads.partnerId),
          eq(facts.conversions.leadId, leads.id)
        )
      )
      .where(and(...conditions))
      .orderBy(desc(leads.receivedAt), desc(leads.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leads)
      .leftJoin(
        facts.treatments,
        and(
          eq(facts.treatments.partnerId, leads.partnerId),
          eq(facts.treatments.leadId, leads.id)
        )
      )
      .leftJoin(
        facts.evidenceByLead,
        and(
          eq(facts.evidenceByLead.partnerId, leads.partnerId),
          eq(facts.evidenceByLead.leadId, leads.id)
        )
      )
      .where(and(...conditions)),
  ]);
  return {
    columns: leadReportColumns(customFields),
    rows: records.map(record => {
      const customData =
        record.customData && typeof record.customData === "object"
          ? (record.customData as Record<string, unknown>)
          : {};
      return {
        id: record.id,
        campaign: record.campaign,
        pdv: record.pdv,
        responsible: record.responsible ?? "",
        name: record.name ?? "Lead sem nome",
        phone: record.phone ?? "",
        email: record.email ?? "",
        status: record.status,
        receivedAt: valueOfDate(record.receivedAt),
        firstAttemptAt: valueOfDate(record.firstAttemptAt),
        firstEffectiveContactAt: valueOfDate(record.firstEffectiveContactAt),
        nextFollowUpAt: valueOfDate(record.nextFollowUpAt),
        attempts: numberOf(record.attempts),
        effectiveContacts: numberOf(record.effectiveContacts),
        hasEvidence: numberOf(record.evidenceCount) ? "Sim" : "Não",
        evidenceCount: numberOf(record.evidenceCount),
        eligibleTreatments: numberOf(record.eligibleTreatments),
        treatmentsWithEvidence: numberOf(record.treatmentsWithEvidence),
        evidenceCoverage: `${Math.round((safeRate(numberOf(record.treatmentsWithEvidence), numberOf(record.eligibleTreatments)) ?? 0) * 1000) / 10}%`,
        requiredEvidencePending: numberOf(record.requiredEvidencePending)
          ? "Sim"
          : "Não",
        hasConversion: record.conversionAt ? "Sim" : "Não",
        conversionAt: valueOfDate(record.conversionAt),
        ...Object.fromEntries(
          customFields.map(field => [
            `custom_${field.key}`,
            customFieldValue(customData[field.key]),
          ])
        ),
      };
    }),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

function operationReportColumns(
  kind: "attempt" | "treatment"
): AnalyticsReportColumn[] {
  return kind === "attempt"
    ? [
        { key: "lead", label: "Lead" },
        { key: "campaign", label: "Campanha" },
        { key: "pdv", label: "PDV" },
        { key: "seller", label: "Vendedor" },
        { key: "occurredAt", label: "Data/hora" },
        { key: "channel", label: "Canal" },
        { key: "result", label: "Resultado" },
        { key: "category", label: "Categoria" },
        { key: "summary", label: "Observação" },
        { key: "followUp", label: "Follow-up gerado" },
        { key: "governance", label: "Governança" },
        { key: "evidenceRequired", label: "Evidência requerida" },
        { key: "evidenceAvailable", label: "Evidência disponível" },
      ]
    : [
        { key: "lead", label: "Lead" },
        { key: "campaign", label: "Campanha" },
        { key: "pdv", label: "PDV" },
        { key: "seller", label: "Vendedor" },
        { key: "occurredAt", label: "Data/hora" },
        { key: "channel", label: "Canal" },
        { key: "result", label: "Resultado" },
        { key: "category", label: "Categoria" },
        { key: "summary", label: "Resumo" },
        { key: "resultingStatus", label: "Situação resultante" },
        { key: "followUp", label: "Follow-up gerado" },
        { key: "governance", label: "Governança" },
        { key: "evidenceRequired", label: "Evidência requerida" },
        { key: "evidenceAvailable", label: "Evidência disponível" },
        { key: "evidenceCount", label: "Quantidade de evidências" },
        { key: "documentaryStatus", label: "Situação documental" },
        { key: "conversion", label: "Conversão associada" },
      ];
}

async function listAttemptReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  const conditions = [
    ...scopeLeadConditions(context, scope, input),
    eq(leadContactAttempts.partnerId, context.partnerId),
    gte(leadContactAttempts.occurredAt, period.start),
    lt(leadContactAttempts.occurredAt, period.end),
  ];
  const actor = alias(userPartners, "report_attempt_actor");
  const actorUser = alias(users, "report_attempt_user");
  const governance = alias(
    leadTreatmentGovernance,
    "report_attempt_governance"
  );
  const evidence = createAvailableEvidenceByEvent(
    db,
    context,
    "report_attempt_available_evidence"
  );
  const followUp = createFollowUpsByOriginEvent(
    db,
    context,
    "report_attempt_follow_up"
  );
  const evidenceCount = sql<number>`coalesce(${evidence.evidenceCount}, 0)`;
  const followUpCount = sql<number>`coalesce(${followUp.followUpCount}, 0)`;
  const requiredEvidence = sql<number>`coalesce(json_extract(${governance.appliedRuleJson}, '$.evidenceRequired'), false)`;
  if (input.evidenceFilter === "with_evidence")
    conditions.push(sql`${evidenceCount} > 0`);
  if (input.evidenceFilter === "without_evidence")
    conditions.push(sql`${evidenceCount} = 0`);
  if (input.evidenceFilter === "required_pending")
    conditions.push(sql`${requiredEvidence} and ${evidenceCount} = 0`);
  const [records, totals] = await Promise.all([
    db
      .select({
        lead: leads.name,
        campaign: campaigns.name,
        pdv: pdvs.name,
        seller: actorUser.name,
        occurredAt: leadContactAttempts.occurredAt,
        channel: leadContactAttempts.channel,
        result: leadContactAttempts.resultLabel,
        category: leadContactAttempts.resultCategory,
        summary: leadContactAttempts.summary,
        rule: governance.appliedRuleJson,
        complete: governance.isComplete,
        followUp: followUpCount,
        evidenceCount,
      })
      .from(leadContactAttempts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContactAttempts.leadId),
          eq(leads.partnerId, leadContactAttempts.partnerId)
        )
      )
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leads.campaignId),
          eq(campaigns.partnerId, leads.partnerId)
        )
      )
      .innerJoin(
        pdvs,
        and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId))
      )
      .innerJoin(
        actor,
        and(
          eq(actor.id, leadContactAttempts.actorMembershipId),
          eq(actor.partnerId, leadContactAttempts.partnerId)
        )
      )
      .innerJoin(actorUser, eq(actorUser.id, actor.userId))
      .leftJoin(
        governance,
        and(
          eq(governance.timelineEventId, leadContactAttempts.timelineEventId),
          eq(governance.partnerId, leadContactAttempts.partnerId),
          eq(governance.leadId, leadContactAttempts.leadId)
        )
      )
      .leftJoin(
        evidence,
        and(
          eq(evidence.partnerId, leadContactAttempts.partnerId),
          eq(evidence.leadId, leadContactAttempts.leadId),
          eq(evidence.timelineEventId, leadContactAttempts.timelineEventId)
        )
      )
      .leftJoin(
        followUp,
        and(
          eq(followUp.partnerId, leadContactAttempts.partnerId),
          eq(followUp.leadId, leadContactAttempts.leadId),
          eq(followUp.timelineEventId, leadContactAttempts.timelineEventId)
        )
      )
      .where(and(...conditions))
      .orderBy(
        desc(leadContactAttempts.occurredAt),
        desc(leadContactAttempts.id)
      )
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leadContactAttempts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContactAttempts.leadId),
          eq(leads.partnerId, leadContactAttempts.partnerId)
        )
      )
      .leftJoin(
        governance,
        and(
          eq(governance.timelineEventId, leadContactAttempts.timelineEventId),
          eq(governance.partnerId, leadContactAttempts.partnerId),
          eq(governance.leadId, leadContactAttempts.leadId)
        )
      )
      .leftJoin(
        evidence,
        and(
          eq(evidence.partnerId, leadContactAttempts.partnerId),
          eq(evidence.leadId, leadContactAttempts.leadId),
          eq(evidence.timelineEventId, leadContactAttempts.timelineEventId)
        )
      )
      .where(and(...conditions)),
  ]);
  return {
    columns: operationReportColumns("attempt"),
    rows: records.map(record => {
      const state = evidenceState(record.rule, record.evidenceCount);
      return {
        lead: record.lead ?? "Lead sem nome",
        campaign: record.campaign,
        pdv: record.pdv,
        seller: record.seller,
        occurredAt: valueOfDate(record.occurredAt),
        channel: record.channel,
        result: record.result,
        category: record.category,
        summary: record.summary ?? "",
        followUp: numberOf(record.followUp) ? "Sim" : "Não",
        governance: record.complete ? "Completa" : state.governance,
        evidenceRequired: state.required ? "Sim" : "Não",
        evidenceAvailable: state.available ? "Sim" : "Não",
        evidenceCount: numberOf(record.evidenceCount),
        documentaryStatus: state.required
          ? state.available
            ? "Atendida"
            : "Pendente"
          : "Não exigida",
      };
    }),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

async function listTreatmentReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  const actor = alias(userPartners, "report_treatment_actor");
  const actorUser = alias(users, "report_treatment_user");
  const governance = alias(
    leadTreatmentGovernance,
    "report_treatment_governance"
  );
  const resultingStatus = alias(
    leadStatuses,
    "report_treatment_resulting_status"
  );
  const evidence = createAvailableEvidenceByEvent(
    db,
    context,
    "report_treatment_available_evidence"
  );
  const followUp = createFollowUpsByOriginEvent(
    db,
    context,
    "report_treatment_follow_up"
  );
  const evidenceCount = sql<number>`coalesce(${evidence.evidenceCount}, 0)`;
  const followUpCount = sql<number>`coalesce(${followUp.followUpCount}, 0)`;
  const requiredEvidence = sql<number>`coalesce(json_extract(${governance.appliedRuleJson}, '$.evidenceRequired'), false)`;
  const conditions = [
    ...scopeLeadConditions(context, scope, input),
    eq(leadContacts.partnerId, context.partnerId),
    eq(leadContacts.recordKind, "effective_contact"),
    gte(leadContacts.occurredAt, period.start),
    lt(leadContacts.occurredAt, period.end),
  ];
  if (input.evidenceFilter === "with_evidence")
    conditions.push(sql`${evidenceCount} > 0`);
  if (input.evidenceFilter === "without_evidence")
    conditions.push(sql`${evidenceCount} = 0`);
  if (input.evidenceFilter === "required_pending")
    conditions.push(sql`${requiredEvidence} and ${evidenceCount} = 0`);
  const [records, totals] = await Promise.all([
    db
      .select({
        lead: leads.name,
        campaign: campaigns.name,
        pdv: pdvs.name,
        seller: actorUser.name,
        occurredAt: leadContacts.occurredAt,
        channel: leadContacts.channel,
        result: leadContacts.resultLabel,
        category: leadContacts.resultCategory,
        summary: leadContacts.summary,
        rule: governance.appliedRuleJson,
        complete: governance.isComplete,
        resultingStatus: resultingStatus.label,
        followUp: followUpCount,
        hasEvidence: sql<number>`case when ${evidenceCount} > 0 then 1 else 0 end`,
        evidenceCount,
        conversionAt: leadConversions.occurredAt,
      })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leads.campaignId),
          eq(campaigns.partnerId, leads.partnerId)
        )
      )
      .innerJoin(
        pdvs,
        and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId))
      )
      .innerJoin(
        actor,
        and(
          eq(actor.id, leadContacts.actorMembershipId),
          eq(actor.partnerId, leadContacts.partnerId)
        )
      )
      .innerJoin(actorUser, eq(actorUser.id, actor.userId))
      .innerJoin(
        leadTimelineEvents,
        and(
          eq(leadTimelineEvents.id, leadContacts.timelineEventId),
          eq(leadTimelineEvents.partnerId, leadContacts.partnerId),
          eq(leadTimelineEvents.leadId, leadContacts.leadId)
        )
      )
      .leftJoin(
        resultingStatus,
        and(
          eq(resultingStatus.partnerId, leadContacts.partnerId),
          sql`${resultingStatus.id} = cast(json_unquote(json_extract(${leadTimelineEvents.payloadJson}, '$.finalStatusId')) as unsigned)`
        )
      )
      .leftJoin(
        governance,
        and(
          eq(governance.timelineEventId, leadContacts.timelineEventId),
          eq(governance.partnerId, leadContacts.partnerId),
          eq(governance.leadId, leadContacts.leadId)
        )
      )
      .leftJoin(
        evidence,
        and(
          eq(evidence.partnerId, leadContacts.partnerId),
          eq(evidence.leadId, leadContacts.leadId),
          eq(evidence.timelineEventId, leadContacts.timelineEventId)
        )
      )
      .leftJoin(
        followUp,
        and(
          eq(followUp.partnerId, leadContacts.partnerId),
          eq(followUp.leadId, leadContacts.leadId),
          eq(followUp.timelineEventId, leadContacts.timelineEventId)
        )
      )
      .leftJoin(
        leadConversions,
        and(
          eq(leadConversions.effectiveContactId, leadContacts.id),
          eq(leadConversions.partnerId, leadContacts.partnerId)
        )
      )
      .where(and(...conditions))
      .orderBy(desc(leadContacts.occurredAt), desc(leadContacts.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .leftJoin(
        governance,
        and(
          eq(governance.timelineEventId, leadContacts.timelineEventId),
          eq(governance.partnerId, leadContacts.partnerId),
          eq(governance.leadId, leadContacts.leadId)
        )
      )
      .leftJoin(
        evidence,
        and(
          eq(evidence.partnerId, leadContacts.partnerId),
          eq(evidence.leadId, leadContacts.leadId),
          eq(evidence.timelineEventId, leadContacts.timelineEventId)
        )
      )
      .where(and(...conditions)),
  ]);
  return {
    columns: operationReportColumns("treatment"),
    rows: records.map(record => {
      const state = evidenceState(record.rule, record.hasEvidence);
      return {
        lead: record.lead ?? "Lead sem nome",
        campaign: record.campaign,
        pdv: record.pdv,
        seller: record.seller,
        occurredAt: valueOfDate(record.occurredAt),
        channel: record.channel,
        result: record.result ?? "",
        category: record.category ?? "",
        summary: record.summary ?? "",
        resultingStatus: record.resultingStatus ?? "",
        followUp: numberOf(record.followUp) ? "Sim" : "Não",
        governance: record.complete ? "Completa" : state.governance,
        evidenceRequired: state.required ? "Sim" : "Não",
        evidenceAvailable: state.available ? "Sim" : "Não",
        evidenceCount: numberOf(record.evidenceCount),
        documentaryStatus: documentaryStatus(record.rule, record.evidenceCount),
        conversion: record.conversionAt ? "Sim" : "Não",
      };
    }),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

async function listConversionReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  const conditions = [
    ...scopeLeadConditions(context, scope, input),
    eq(leadConversions.partnerId, context.partnerId),
    gte(leadConversions.occurredAt, period.start),
    lt(leadConversions.occurredAt, period.end),
  ];
  const actor = alias(userPartners, "report_conversion_actor");
  const actorUser = alias(users, "report_conversion_user");
  const convertedStatus = alias(leadStatuses, "report_conversion_status");
  const currentStatus = alias(leadStatuses, "report_conversion_current_status");
  const reopened = createReopenedConversionFacts(db, context);
  const [records, totals] = await Promise.all([
    db
      .select({
        lead: leads.name,
        campaign: campaigns.name,
        pdv: pdvs.name,
        seller: actorUser.name,
        occurredAt: leadConversions.occurredAt,
        result: leadContacts.resultLabel,
        conversionStatus: convertedStatus.label,
        currentStatus: currentStatus.label,
        reopened: sql<number>`coalesce(${reopened.reopened}, 0)`,
      })
      .from(leadConversions)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadConversions.leadId),
          eq(leads.partnerId, leadConversions.partnerId)
        )
      )
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leads.campaignId),
          eq(campaigns.partnerId, leads.partnerId)
        )
      )
      .innerJoin(
        pdvs,
        and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId))
      )
      .innerJoin(
        actor,
        and(
          eq(actor.id, leadConversions.actorMembershipId),
          eq(actor.partnerId, leadConversions.partnerId)
        )
      )
      .innerJoin(actorUser, eq(actorUser.id, actor.userId))
      .innerJoin(
        leadContacts,
        and(
          eq(leadContacts.id, leadConversions.effectiveContactId),
          eq(leadContacts.partnerId, leadConversions.partnerId),
          eq(leadContacts.leadId, leadConversions.leadId)
        )
      )
      .innerJoin(
        convertedStatus,
        and(
          eq(convertedStatus.id, leadConversions.statusId),
          eq(convertedStatus.partnerId, leadConversions.partnerId)
        )
      )
      .innerJoin(
        currentStatus,
        and(
          eq(currentStatus.id, leads.statusId),
          eq(currentStatus.partnerId, leads.partnerId)
        )
      )
      .leftJoin(
        reopened,
        and(
          eq(reopened.partnerId, leadConversions.partnerId),
          eq(reopened.conversionId, leadConversions.id)
        )
      )
      .where(and(...conditions))
      .orderBy(desc(leadConversions.occurredAt), desc(leadConversions.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leadConversions)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadConversions.leadId),
          eq(leads.partnerId, leadConversions.partnerId)
        )
      )
      .where(and(...conditions)),
  ]);
  const columns: AnalyticsReportColumn[] = [
    { key: "lead", label: "Lead" },
    { key: "campaign", label: "Campanha" },
    { key: "pdv", label: "PDV" },
    { key: "seller", label: "Vendedor" },
    { key: "occurredAt", label: "Data/hora da conversão" },
    { key: "result", label: "Resultado" },
    { key: "conversionStatus", label: "Situação produzida" },
    { key: "currentStatus", label: "Situação atual" },
    { key: "reopened", label: "Reaberto posteriormente" },
  ];
  return {
    columns,
    rows: records.map(record => ({
      lead: record.lead ?? "Lead sem nome",
      campaign: record.campaign,
      pdv: record.pdv,
      seller: record.seller,
      occurredAt: valueOfDate(record.occurredAt),
      result: record.result ?? "",
      conversionStatus: record.conversionStatus,
      currentStatus: record.currentStatus,
      reopened: numberOf(record.reopened) ? "Sim" : "Não",
    })),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

async function listFollowUpReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period, now } = analytics;
  const pagination = reportPagination(input, maximum);
  const dateField =
    input.followUpDateField === "createdAt"
      ? followUps.createdAt
      : followUps.dueAt;
  const day = partnerDayBounds(period.timeZone, now);
  const conditions = [
    ...scopeLeadConditions(context, scope, input),
    eq(followUps.partnerId, context.partnerId),
    gte(dateField, period.start),
    lt(dateField, period.end),
  ];
  if (input.followUpSituation === "overdue")
    conditions.push(eq(followUps.status, "pending"), lt(followUps.dueAt, now));
  if (input.followUpSituation === "today")
    conditions.push(
      eq(followUps.status, "pending"),
      gte(followUps.dueAt, day.start),
      lt(followUps.dueAt, day.end)
    );
  if (input.followUpSituation === "upcoming")
    conditions.push(
      eq(followUps.status, "pending"),
      gte(followUps.dueAt, day.end)
    );
  if (input.followUpSituation === "pending")
    conditions.push(eq(followUps.status, "pending"));
  if (input.followUpSituation === "completed")
    conditions.push(eq(followUps.status, "completed"));
  if (input.followUpSituation === "cancelled")
    conditions.push(eq(followUps.status, "cancelled"));
  const owner = alias(userPartners, "report_follow_up_owner");
  const ownerUser = alias(users, "report_follow_up_owner_user");
  const origin = alias(leadTimelineEvents, "report_follow_up_origin");
  const lastInteraction = createLastOperationalInteractionByLead(db, context);
  const [records, totals] = await Promise.all([
    db
      .select({
        lead: leads.name,
        responsible: ownerUser.name,
        pdv: pdvs.name,
        campaign: campaigns.name,
        createdAt: followUps.createdAt,
        dueAt: followUps.dueAt,
        status: followUps.status,
        completedAt: followUps.completedAt,
        cancelledAt: followUps.cancelledAt,
        note: followUps.note,
        rescheduledFromId: followUps.rescheduledFromId,
        originType: origin.type,
        lastInteractionAt: lastInteraction.lastInteractionAt,
      })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leads.campaignId),
          eq(campaigns.partnerId, leads.partnerId)
        )
      )
      .innerJoin(
        pdvs,
        and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId))
      )
      .innerJoin(
        owner,
        and(
          eq(owner.id, followUps.ownerMembershipId),
          eq(owner.partnerId, followUps.partnerId)
        )
      )
      .innerJoin(ownerUser, eq(ownerUser.id, owner.userId))
      .leftJoin(
        origin,
        and(
          eq(origin.id, followUps.originTimelineEventId),
          eq(origin.partnerId, followUps.partnerId),
          eq(origin.leadId, followUps.leadId)
        )
      )
      .leftJoin(
        lastInteraction,
        and(
          eq(lastInteraction.partnerId, followUps.partnerId),
          eq(lastInteraction.leadId, followUps.leadId)
        )
      )
      .where(and(...conditions))
      .orderBy(asc(followUps.dueAt), asc(followUps.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .where(and(...conditions)),
  ]);
  const columns: AnalyticsReportColumn[] = [
    { key: "lead", label: "Lead" },
    { key: "responsible", label: "Responsável" },
    { key: "pdv", label: "PDV" },
    { key: "campaign", label: "Campanha" },
    { key: "createdAt", label: "Criado em" },
    { key: "dueAt", label: "Vencimento" },
    { key: "status", label: "Status" },
    { key: "derivedStatus", label: "Situação atual" },
    { key: "completedAt", label: "Concluído em" },
    { key: "cancelledAt", label: "Cancelado em" },
    { key: "origin", label: "Origem" },
    { key: "note", label: "Motivo/observação" },
    { key: "lastInteractionAt", label: "Última interação" },
  ];
  const originLabel = (type: string | null) =>
    type === "contact_attempted"
      ? "Tentativa"
      : type === "effective_contact_recorded"
        ? "Tratativa"
        : "Independente";
  return {
    columns,
    rows: records.map(record => ({
      lead: record.lead ?? "Lead sem nome",
      responsible: record.responsible,
      pdv: record.pdv,
      campaign: record.campaign,
      createdAt: valueOfDate(record.createdAt),
      dueAt: valueOfDate(record.dueAt),
      status: record.status,
      derivedStatus:
        record.status === "pending" && record.dueAt < now
          ? "Vencido"
          : record.status === "pending"
            ? record.dueAt < day.end
              ? "Hoje"
              : "A vencer"
            : record.status === "completed"
              ? "Concluído"
              : "Cancelado",
      completedAt: valueOfDate(record.completedAt),
      cancelledAt: valueOfDate(record.cancelledAt),
      origin: record.rescheduledFromId
        ? `${originLabel(record.originType)} · reagendado`
        : originLabel(record.originType),
      note: record.note ?? "",
      lastInteractionAt: valueOfDate(record.lastInteractionAt),
    })),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

async function listImportReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  const conditions: SQL[] = [
    eq(leadImportBatches.partnerId, context.partnerId),
    gte(leadImportBatches.createdAt, period.start),
    lt(leadImportBatches.createdAt, period.end),
  ];
  if (input.campaignId)
    conditions.push(eq(leadImportBatches.campaignId, input.campaignId));
  if (input.pdvId)
    conditions.push(eq(leadImportBatches.targetPdvId, input.pdvId));
  if (scope.pdvIds)
    conditions.push(inArray(leadImportBatches.targetPdvId, scope.pdvIds));
  const [records, totals] = await Promise.all([
    db
      .select({
        batch: leadImportBatches.id,
        campaign: campaigns.name,
        fileName: leadImportBatches.fileName,
        total: leadImportBatches.totalRows,
        valid: leadImportBatches.validRows,
        invalid: leadImportBatches.invalidRows,
        imported: leadImportBatches.importedRows,
        duplicates: leadImportBatches.duplicateRows,
        rejected: leadImportBatches.rejectedRows,
        status: leadImportBatches.status,
        createdAt: leadImportBatches.createdAt,
      })
      .from(leadImportBatches)
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leadImportBatches.campaignId),
          eq(campaigns.partnerId, leadImportBatches.partnerId)
        )
      )
      .where(and(...conditions))
      .orderBy(desc(leadImportBatches.createdAt), desc(leadImportBatches.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leadImportBatches)
      .where(and(...conditions)),
  ]);
  const columns: AnalyticsReportColumn[] = [
    { key: "batch", label: "Batch" },
    { key: "campaign", label: "Campanha" },
    { key: "fileName", label: "Arquivo" },
    { key: "total", label: "Total" },
    { key: "valid", label: "Válidos" },
    { key: "invalid", label: "Inválidos" },
    { key: "imported", label: "Importados" },
    { key: "duplicates", label: "Duplicados" },
    { key: "rejected", label: "Rejeitados" },
    { key: "status", label: "Status" },
    { key: "createdAt", label: "Data" },
  ];
  return {
    columns,
    rows: records.map(record => ({
      ...record,
      createdAt: valueOfDate(record.createdAt),
    })),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

async function listDistributionReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  if (scope.pdvIds) {
    // A distribution batch can span several PDVs and cannot be split safely.
    // Managers use the operational distribution screen for scoped detail.
    return {
      columns: [] as AnalyticsReportColumn[],
      rows: [] as AnalyticsReportRow[],
      total: 0,
      ...pagination,
    };
  }
  const conditions: SQL[] = [
    eq(leadDistributionBatches.partnerId, context.partnerId),
    gte(leadDistributionBatches.createdAt, period.start),
    lt(leadDistributionBatches.createdAt, period.end),
  ];
  if (input.campaignId)
    conditions.push(eq(leadDistributionBatches.campaignId, input.campaignId));
  const [records, totals] = await Promise.all([
    db
      .select({
        operation: leadDistributionBatches.type,
        campaign: campaigns.name,
        strategy: leadDistributionBatches.strategy,
        requested: leadDistributionBatches.requestedCount,
        processed: leadDistributionBatches.processedCount,
        success: leadDistributionBatches.successCount,
        skipped: leadDistributionBatches.skippedCount,
        failed: leadDistributionBatches.failedCount,
        createdAt: leadDistributionBatches.createdAt,
      })
      .from(leadDistributionBatches)
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, leadDistributionBatches.campaignId),
          eq(campaigns.partnerId, leadDistributionBatches.partnerId)
        )
      )
      .where(and(...conditions))
      .orderBy(
        desc(leadDistributionBatches.createdAt),
        desc(leadDistributionBatches.id)
      )
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leadDistributionBatches)
      .where(and(...conditions)),
  ]);
  const columns: AnalyticsReportColumn[] = [
    { key: "operation", label: "Operação" },
    { key: "campaign", label: "Campanha" },
    { key: "strategy", label: "Estratégia" },
    { key: "requested", label: "Solicitados" },
    { key: "processed", label: "Processados" },
    { key: "success", label: "Sucesso" },
    { key: "skipped", label: "Ignorados" },
    { key: "failed", label: "Falhas" },
    { key: "createdAt", label: "Data" },
  ];
  return {
    columns,
    rows: records.map(record => ({
      ...record,
      createdAt: valueOfDate(record.createdAt),
    })),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

/** SQL-paginated report registry. Each fact has an explicit official source. */
export async function listAnalyticsReport(
  context: PartnerContext,
  input: AnalyticsReportInput,
  options: { maximum?: number } = {}
): Promise<AnalyticsReportPage> {
  if (
    context.role === "seller" &&
    (input.type === "imports" || input.type === "distributions")
  )
    throw new Error("Este relatório é destinado à gestão do parceiro");
  try {
    const analytics = await createAnalyticsContext(context, input);
    const maximum = options.maximum ?? REPORT_PAGE_MAX;
    const result =
      input.type === "leads"
        ? await listLeadsReport(analytics, context, input, maximum)
        : input.type === "attempts"
          ? await listAttemptReport(analytics, context, input, maximum)
          : input.type === "treatments"
            ? await listTreatmentReport(analytics, context, input, maximum)
            : input.type === "conversions"
              ? await listConversionReport(analytics, context, input, maximum)
              : input.type === "follow_ups"
                ? await listFollowUpReport(analytics, context, input, maximum)
                : input.type === "imports"
                  ? await listImportReport(analytics, context, input, maximum)
                  : await listDistributionReport(
                      analytics,
                      context,
                      input,
                      maximum
                    );
    return {
      type: input.type,
      columns: result.columns,
      rows: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      period: {
        start: analytics.period.start,
        end: analytics.period.end,
        timeZone: analytics.period.timeZone,
        label: analytics.period.label,
      },
    };
  } catch (error) {
    let diagnosticError = error;
    const visited = new Set<unknown>();
    while (
      diagnosticError &&
      typeof diagnosticError === "object" &&
      "cause" in diagnosticError &&
      !visited.has(diagnosticError)
    ) {
      visited.add(diagnosticError);
      const cause = (diagnosticError as { cause?: unknown }).cause;
      if (!cause || typeof cause !== "object") break;
      diagnosticError = cause;
    }
    const details =
      diagnosticError && typeof diagnosticError === "object"
        ? (diagnosticError as {
            code?: unknown;
            errno?: unknown;
            sqlState?: unknown;
          })
        : {};
    console.error("[analytics.reports] list failed", {
      reportType: input.type,
      partnerId: context.partnerId,
      role: context.role,
      pdvScopeMode: context.pdvScopeMode,
      hasCampaignFilter: Boolean(input.campaignId),
      hasPdvFilter: Boolean(input.pdvId),
      hasSellerFilter: Boolean(input.sellerMembershipId),
      periodPreset: input.preset ?? "this_month",
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCauseName:
        diagnosticError instanceof Error ? diagnosticError.name : undefined,
      errorCode: typeof details.code === "string" ? details.code : undefined,
      errorErrno: typeof details.errno === "number" ? details.errno : undefined,
      errorSqlState:
        typeof details.sqlState === "string" ? details.sqlState : undefined,
      errorMessage:
        diagnosticError instanceof Error
          ? diagnosticError.message
          : "Unknown error",
    });
    throw error;
  }
}

function csvCell(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function formatAnalyticsCsv(
  columns: AnalyticsReportColumn[],
  rows: AnalyticsReportRow[]
) {
  const header = columns.map(column => csvCell(column.label)).join(",");
  const body = rows.map(row =>
    columns.map(column => csvCell(row[column.key])).join(",")
  );
  return `\ufeff${[header, ...body].join("\r\n")}\r\n`;
}

export async function exportAnalyticsReport(
  context: PartnerContext,
  input: Omit<AnalyticsReportInput, "page" | "pageSize">
) {
  const report = await listAnalyticsReport(
    context,
    { ...input, page: 1, pageSize: EXPORT_ROW_MAX },
    { maximum: EXPORT_ROW_MAX }
  );
  if (report.total > EXPORT_ROW_MAX)
    throw new Error(
      `A exportação encontrou mais de ${EXPORT_ROW_MAX} linhas. Refine os filtros antes de exportar.`
    );
  const db = await getV2Db();
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "analytics_report_exported",
    entityType: `report_${input.type}`,
    metadata: {
      reportType: input.type,
      campaignId: input.campaignId ?? null,
      pdvId: input.pdvId ?? null,
      sellerMembershipId: input.sellerMembershipId ?? null,
      periodStart: report.period.start.toISOString(),
      periodEnd: report.period.end.toISOString(),
      exportedCount: report.rows.length,
    },
  });
  const from = report.period.start.toISOString().slice(0, 10);
  const until = new Date(report.period.end.getTime() - 1)
    .toISOString()
    .slice(0, 10);
  return {
    fileName: `fluxo-${input.type}-${from}-${until}.csv`,
    content: formatAnalyticsCsv(report.columns, report.rows),
    total: report.rows.length,
  };
}
