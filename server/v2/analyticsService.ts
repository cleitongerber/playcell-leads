import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
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
  if (context.role === "super_admin" || context.role === "partner_admin") {
    return { pdvIds: null, ownMembershipId: null };
  }
  if (!context.membershipId) throw new Error("Membership ativa é necessária");
  const rows = await db
    .select({ pdvId: userPdvAssignments.pdvId })
    .from(userPdvAssignments)
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId),
        eq(userPdvAssignments.isActive, true)
      )
    );
  return {
    pdvIds: rows.map(row => row.pdvId),
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
  const [leadRows, attemptRows, contactRows, conversionRows, overdueRows] =
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
  const contacts = new Map(contactRows.map(row => [row.id, row]));
  const conversions = new Map(conversionRows.map(row => [row.id, row]));
  const overdue = new Map(overdueRows.map(row => [row.id, row]));
  return leadRows.map(row => {
    const attempt = attempts.get(row.id);
    const contact = contacts.get(row.id);
    const conversion = conversions.get(row.id);
    return {
      id: row.id,
      name: row.name,
      leads: numberOf(row.leads),
      attempts: numberOf(attempt?.attempts),
      leadsWithAttempt: numberOf(attempt?.attempted),
      effectiveContacts: numberOf(contact?.contacts),
      leadsWithEffectiveContact: numberOf(contact?.contacted),
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
    },
    campaigns: campaignsOverview,
    pdvs: pdvsOverview,
  };
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
        attempts: 0,
        effectiveContacts: 0,
        worked: 0,
        conversions: 0,
        followUpsOverdue: 0,
      },
      sellers: [] as ProductivityRow[],
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
    followUpCompletionRate: safeRate(
      row.followUpsCompleted,
      row.followUpsCompleted + row.followUpsPending
    ),
  }));
  return {
    period: {
      start: period.start,
      end: period.end,
      timeZone: period.timeZone,
      label: period.label,
    },
    totals: {
      sellers: rows.length,
      attempts: rows.reduce((total, row) => total + row.attempts, 0),
      effectiveContacts: rows.reduce(
        (total, row) => total + row.effectiveContacts,
        0
      ),
      worked: rows.reduce((total, row) => total + row.leadsWorked, 0),
      conversions: rows.reduce((total, row) => total + row.conversions, 0),
      followUpsOverdue: rows.reduce(
        (total, row) => total + row.followUpsOverdue,
        0
      ),
    },
    sellers: rows,
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
  input: AnalyticsReportInput,
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
    { key: "hasConversion", label: "Possui conversão" },
    { key: "conversionAt", label: "Data da conversão" },
    ...customFields.map(field => ({
      key: `custom_${field.key}`,
      label: field.label,
    })),
  ];
}

async function listLeadsReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  const conditions = [
    ...scopeLeadConditions(context, scope, input),
    gte(leads.receivedAt, period.start),
    lt(leads.receivedAt, period.end),
  ];
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
        attempts: sql<number>`(select count(*) from ${leadContactAttempts} where ${leadContactAttempts.partnerId} = ${leads.partnerId} and ${leadContactAttempts.leadId} = ${leads.id})`,
        effectiveContacts: sql<number>`(select count(*) from ${leadContacts} where ${leadContacts.partnerId} = ${leads.partnerId} and ${leadContacts.leadId} = ${leads.id} and ${leadContacts.recordKind} = 'effective_contact')`,
        conversionAt: sql<Date | null>`(select min(${leadConversions.occurredAt}) from ${leadConversions} where ${leadConversions.partnerId} = ${leads.partnerId} and ${leadConversions.leadId} = ${leads.id})`,
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
      .where(and(...conditions))
      .orderBy(desc(leads.receivedAt), desc(leads.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leads)
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
  const evidence = alias(leadEvidences, "report_attempt_evidence");
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
        followUp: sql<number>`case when exists (select 1 from ${followUps} where ${followUps.partnerId} = ${leadContactAttempts.partnerId} and ${followUps.leadId} = ${leadContactAttempts.leadId} and ${followUps.originTimelineEventId} = ${leadContactAttempts.timelineEventId}) then 1 else 0 end`,
        hasEvidence: sql<number>`case when exists (select 1 from ${evidence} where ${evidence.partnerId} = ${leadContactAttempts.partnerId} and ${evidence.leadId} = ${leadContactAttempts.leadId} and ${evidence.timelineEventId} = ${leadContactAttempts.timelineEventId} and ${evidence.deletedAt} is null and ${evidence.storageStatus} = 'available') then 1 else 0 end`,
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
      .where(and(...conditions)),
  ]);
  return {
    columns: operationReportColumns("attempt"),
    rows: records.map(record => {
      const state = evidenceState(record.rule, record.hasEvidence);
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
  const conditions = [
    ...scopeLeadConditions(context, scope, input),
    eq(leadContacts.partnerId, context.partnerId),
    eq(leadContacts.recordKind, "effective_contact"),
    gte(leadContacts.occurredAt, period.start),
    lt(leadContacts.occurredAt, period.end),
  ];
  const actor = alias(userPartners, "report_treatment_actor");
  const actorUser = alias(users, "report_treatment_user");
  const governance = alias(
    leadTreatmentGovernance,
    "report_treatment_governance"
  );
  const evidence = alias(leadEvidences, "report_treatment_evidence");
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
        resultingStatus: sql<
          string | null
        >`(select ${leadStatuses.label} from ${leadStatuses} where ${leadStatuses.partnerId} = ${leadContacts.partnerId} and ${leadStatuses.id} = cast(json_unquote(json_extract(${leadTimelineEvents.payloadJson}, '$.finalStatusId')) as unsigned) limit 1)`,
        followUp: sql<number>`case when exists (select 1 from ${followUps} where ${followUps.partnerId} = ${leadContacts.partnerId} and ${followUps.leadId} = ${leadContacts.leadId} and ${followUps.originTimelineEventId} = ${leadContacts.timelineEventId}) then 1 else 0 end`,
        hasEvidence: sql<number>`case when exists (select 1 from ${evidence} where ${evidence.partnerId} = ${leadContacts.partnerId} and ${evidence.leadId} = ${leadContacts.leadId} and ${evidence.timelineEventId} = ${leadContacts.timelineEventId} and ${evidence.deletedAt} is null and ${evidence.storageStatus} = 'available') then 1 else 0 end`,
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
        governance,
        and(
          eq(governance.timelineEventId, leadContacts.timelineEventId),
          eq(governance.partnerId, leadContacts.partnerId),
          eq(governance.leadId, leadContacts.leadId)
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
        reopened: sql<number>`case when exists (select 1 from ${leadTimelineEvents} where ${leadTimelineEvents.partnerId} = ${leadConversions.partnerId} and ${leadTimelineEvents.leadId} = ${leadConversions.leadId} and ${leadTimelineEvents.type} = 'lead_reopened' and ${leadTimelineEvents.occurredAt} > ${leadConversions.occurredAt}) then 1 else 0 end`,
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
  const conditions = [
    ...scopeLeadConditions(context, scope, input),
    eq(followUps.partnerId, context.partnerId),
    gte(followUps.dueAt, period.start),
    lt(followUps.dueAt, period.end),
  ];
  const owner = alias(userPartners, "report_follow_up_owner");
  const ownerUser = alias(users, "report_follow_up_owner_user");
  const origin = alias(leadTimelineEvents, "report_follow_up_origin");
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
        rescheduledFromId: followUps.rescheduledFromId,
        originType: origin.type,
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
            ? "Pendente"
            : record.status === "completed"
              ? "Concluído"
              : "Cancelado",
      completedAt: valueOfDate(record.completedAt),
      cancelledAt: valueOfDate(record.cancelledAt),
      origin: record.rescheduledFromId
        ? `${originLabel(record.originType)} · reagendado`
        : originLabel(record.originType),
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
