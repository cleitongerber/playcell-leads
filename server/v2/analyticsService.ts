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
  min,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  campaignPdvs,
  campaigns,
  customFieldDefinitions,
  followUps,
  leadContacts,
  leadDistributionBatches,
  leadEvidences,
  leadImportBatches,
  importTemplates,
  importTemplateVersions,
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
import { type PartnerContext } from "./access";
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
import { writeV2Audit } from "./partnerService";
import {
  pdvIsInsideAnalyticsScope,
  sellerIsInsideAnalyticsScope,
} from "./analyticsScopePolicy";

const REPORT_PAGE_MAX = 100;
const EXPORT_ROW_MAX = 25_000;

export type AnalyticsFilters = AnalyticsDateRangeInput & {
  campaignId?: number;
  pdvId?: number;
  sellerMembershipId?: number;
};

export type AnalyticsReportType =
  | "leads"
  | "treatments"
  | "follow_ups"
  | "imports"
  | "distributions";

export type AnalyticsReportInput = AnalyticsFilters & {
  type: AnalyticsReportType;
  page: number;
  pageSize: number;
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

export type AnalyticsReportRow = Record<string, string | number | null>;

function numberOf(value: unknown) {
  return Number(value ?? 0);
}

function valueOfDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function analyticsScopeConditions(
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
  if (scope.pdvIds && !scope.pdvIds.length)
    throw new Error("Não há PDVs ativos no seu escopo analítico");

  if (filters.pdvId) {
    const validPdv = (
      await db
        .select({ id: pdvs.id })
        .from(pdvs)
        .where(
          and(eq(pdvs.id, filters.pdvId), eq(pdvs.partnerId, context.partnerId))
        )
        .limit(1)
    )[0];
    if (!validPdv || !pdvIsInsideAnalyticsScope(scope.pdvIds, filters.pdvId)) {
      throw new Error("PDV indisponível no seu escopo");
    }
  }

  if (filters.campaignId) {
    const campaign = (
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
    if (!campaign) throw new Error("Campanha indisponível no seu escopo");
    if (scope.pdvIds) {
      const scopedCampaignPdv = (
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
      if (!scopedCampaignPdv)
        throw new Error("Campanha indisponível no seu escopo");
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
    if (scope.pdvIds) {
      const sharedPdv = (
        await db
          .select({ id: userPdvAssignments.id })
          .from(userPdvAssignments)
          .where(
            and(
              eq(userPdvAssignments.partnerId, context.partnerId),
              eq(userPdvAssignments.membershipId, filters.sellerMembershipId),
              eq(userPdvAssignments.isActive, true),
              inArray(userPdvAssignments.pdvId, scope.pdvIds)
            )
          )
          .limit(1)
      )[0];
      if (!sharedPdv) throw new Error("Vendedor indisponível no seu escopo");
    }
  }
}

async function createAnalyticsContext(
  context: PartnerContext,
  filters: AnalyticsFilters,
  now = new Date()
): Promise<AnalyticsContext> {
  const db = await getV2Db();
  const [scope, settings] = await Promise.all([
    resolveAnalyticsScope(db, context),
    db
      .select({
        timezone: partnerSettings.timezone,
        staleLeadMinutes: partnerSettings.staleLeadMinutes,
      })
      .from(partnerSettings)
      .where(eq(partnerSettings.partnerId, context.partnerId))
      .limit(1),
  ]);
  const configuration = settings[0] ?? {
    timezone: "America/Sao_Paulo",
    staleLeadMinutes: 1440,
  };
  await assertAnalyticsFilters(db, context, scope, filters);
  return {
    db,
    scope,
    period: resolveAnalyticsPeriod(configuration.timezone, filters, now),
    now,
    staleLeadMinutes: configuration.staleLeadMinutes,
  };
}

async function queryCohortMetrics(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  period: Pick<AnalyticsPeriod, "start" | "end">
) {
  const conditions = [
    ...analyticsScopeConditions(context, scope, filters),
    gte(leads.receivedAt, period.start),
    lt(leads.receivedAt, period.end),
  ];
  const assignmentEvent = alias(
    leadTimelineEvents,
    "analytics_cohort_assignment_event"
  );
  const contact = alias(leadContacts, "analytics_cohort_contact");
  const terminalEvent = alias(
    leadTimelineEvents,
    "analytics_cohort_terminal_event"
  );
  const terminalStatus = alias(
    leadStatuses,
    "analytics_cohort_terminal_status"
  );
  const conversionEvent = alias(
    leadTimelineEvents,
    "analytics_cohort_conversion_event"
  );
  const conversionStatus = alias(
    leadStatuses,
    "analytics_cohort_conversion_status"
  );

  // TiDB rejects a correlated EXISTS nested under SUM. Keep each metric an
  // independent aggregate query instead: every result remains SQL-side, while
  // COUNT DISTINCT preserves the one-lead/one-metric definition.
  const [
    receivedRows,
    assignedRows,
    treatedRows,
    completedRows,
    convertedRows,
  ] = await Promise.all([
    db
      .select({ total: count() })
      .from(leads)
      .where(and(...conditions)),
    db
      .select({ total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        assignmentEvent,
        and(
          eq(assignmentEvent.partnerId, leads.partnerId),
          eq(assignmentEvent.leadId, leads.id)
        )
      )
      .where(
        and(
          ...conditions,
          inArray(assignmentEvent.type, [
            "assigned",
            "lead_distributed",
            "lead_reassigned",
          ]),
          lt(assignmentEvent.occurredAt, period.end)
        )
      ),
    db
      .select({ total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        contact,
        and(
          eq(contact.partnerId, leads.partnerId),
          eq(contact.leadId, leads.id)
        )
      )
      .where(
        and(
          ...conditions,
          eq(contact.partnerId, context.partnerId),
          lt(contact.occurredAt, period.end)
        )
      ),
    db
      .select({ total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        terminalEvent,
        and(
          eq(terminalEvent.partnerId, leads.partnerId),
          eq(terminalEvent.leadId, leads.id)
        )
      )
      .innerJoin(
        terminalStatus,
        and(
          sql`${terminalStatus.id} = cast(json_unquote(json_extract(${terminalEvent.payloadJson}, '$.statusId')) as unsigned)`,
          eq(terminalStatus.partnerId, terminalEvent.partnerId)
        )
      )
      .where(
        and(
          ...conditions,
          eq(terminalEvent.partnerId, context.partnerId),
          eq(terminalEvent.type, "status_changed"),
          lt(terminalEvent.occurredAt, period.end),
          eq(terminalStatus.isTerminal, true)
        )
      ),
    db
      .select({ total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        conversionEvent,
        and(
          eq(conversionEvent.partnerId, leads.partnerId),
          eq(conversionEvent.leadId, leads.id)
        )
      )
      .innerJoin(
        conversionStatus,
        and(
          sql`${conversionStatus.id} = cast(json_unquote(json_extract(${conversionEvent.payloadJson}, '$.statusId')) as unsigned)`,
          eq(conversionStatus.partnerId, conversionEvent.partnerId)
        )
      )
      .where(
        and(
          ...conditions,
          eq(conversionEvent.partnerId, context.partnerId),
          eq(conversionEvent.type, "status_changed"),
          lt(conversionEvent.occurredAt, period.end),
          eq(conversionStatus.isTerminal, true),
          eq(conversionStatus.category, "completed")
        )
      ),
  ]);
  return {
    received: numberOf(receivedRows[0]?.total),
    assigned: numberOf(assignedRows[0]?.total),
    treated: numberOf(treatedRows[0]?.total),
    completed: numberOf(completedRows[0]?.total),
    converted: numberOf(convertedRows[0]?.total),
  };
}

async function queryPeriodActivityMetrics(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  period: Pick<AnalyticsPeriod, "start" | "end">
) {
  const leadConditions = analyticsScopeConditions(context, scope, filters);
  const contactConditions = [
    ...leadConditions,
    eq(leadContacts.partnerId, context.partnerId),
    gte(leadContacts.occurredAt, period.start),
    lt(leadContacts.occurredAt, period.end),
  ];
  const event = alias(leadTimelineEvents, "analytics_period_status_event");
  const targetStatus = alias(leadStatuses, "analytics_period_target_status");
  const eventConditions = [
    ...leadConditions,
    eq(event.partnerId, context.partnerId),
    eq(event.type, "status_changed"),
    gte(event.occurredAt, period.start),
    lt(event.occurredAt, period.end),
  ];
  const firstContactConditions = [
    ...leadConditions,
    isNotNull(leads.firstContactAt),
    gte(leads.firstContactAt, period.start),
    lt(leads.firstContactAt, period.end),
  ];
  const [contacts, completed, converted, firstContact] = await Promise.all([
    db
      .select({ treated: countDistinct(leadContacts.leadId) })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .where(and(...contactConditions)),
    db
      .select({ total: countDistinct(event.leadId) })
      .from(event)
      .innerJoin(
        leads,
        and(eq(leads.id, event.leadId), eq(leads.partnerId, event.partnerId))
      )
      .innerJoin(
        targetStatus,
        and(
          sql`${targetStatus.id} = cast(json_unquote(json_extract(${event.payloadJson}, '$.statusId')) as unsigned)`,
          eq(targetStatus.partnerId, event.partnerId)
        )
      )
      .where(and(...eventConditions, eq(targetStatus.isTerminal, true))),
    db
      .select({ total: countDistinct(event.leadId) })
      .from(event)
      .innerJoin(
        leads,
        and(eq(leads.id, event.leadId), eq(leads.partnerId, event.partnerId))
      )
      .innerJoin(
        targetStatus,
        and(
          sql`${targetStatus.id} = cast(json_unquote(json_extract(${event.payloadJson}, '$.statusId')) as unsigned)`,
          eq(targetStatus.partnerId, event.partnerId)
        )
      )
      .where(
        and(
          ...eventConditions,
          eq(targetStatus.isTerminal, true),
          eq(targetStatus.category, "completed")
        )
      ),
    db
      .select({
        averageSeconds: sql<
          number | null
        >`avg(timestampdiff(second, ${leads.receivedAt}, ${leads.firstContactAt}))`,
        contacted: count(),
      })
      .from(leads)
      .where(and(...firstContactConditions)),
  ]);
  return {
    treated: numberOf(contacts[0]?.treated),
    completed: numberOf(completed[0]?.total),
    converted: numberOf(converted[0]?.total),
    firstContactAverageSeconds:
      firstContact[0]?.averageSeconds == null
        ? null
        : numberOf(firstContact[0]?.averageSeconds),
    firstContacts: numberOf(firstContact[0]?.contacted),
  };
}

function operationalLeadConditions(
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters
) {
  return [
    ...analyticsScopeConditions(context, scope, filters),
    inArray(leadStatuses.category, ["open", "in_progress"]),
    eq(campaigns.status, "active"),
    eq(campaigns.isFrozen, false),
    eq(campaignPdvs.isActive, true),
    eq(pdvs.isActive, true),
  ];
}

async function queryDashboardStocks(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  period: AnalyticsPeriod,
  now: Date,
  staleLeadMinutes: number
) {
  const operational = operationalLeadConditions(context, scope, filters);
  const today = resolveAnalyticsPeriod(
    period.timeZone,
    { preset: "today" },
    now
  );
  const staleBefore = new Date(now.getTime() - staleLeadMinutes * 60_000);
  // These are fixed aggregate queries, never a query per lead.
  const leadAggregate = db
    .select({
      available: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is null then 1 else 0 end), 0)`,
      inPortfolio: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is not null then 1 else 0 end), 0)`,
      assignedWithoutFirstContact: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is not null and ${leads.firstContactAt} is null then 1 else 0 end), 0)`,
      stale: sql<number>`coalesce(sum(case when (${leads.lastActivityAt} is null or ${leads.lastActivityAt} < ${staleBefore}) then 1 else 0 end), 0)`,
    })
    .from(leads)
    .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .innerJoin(
      campaignPdvs,
      and(
        eq(campaignPdvs.campaignId, leads.campaignId),
        eq(campaignPdvs.pdvId, leads.pdvId),
        eq(campaignPdvs.partnerId, leads.partnerId)
      )
    )
    .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
    .where(and(...operational));

  const followUpConditions = [
    ...analyticsScopeConditions(context, scope, filters),
    eq(followUps.partnerId, context.partnerId),
    eq(followUps.status, "pending"),
  ];
  const governanceConditions = [
    ...analyticsScopeConditions(context, scope, filters),
    eq(leadTreatmentGovernance.partnerId, context.partnerId),
    eq(leadTreatmentGovernance.isComplete, false),
  ];
  const [leadRows, followUpRows, governanceRows] = await Promise.all([
    leadAggregate,
    db
      .select({
        overdue: sql<number>`coalesce(sum(case when ${followUps.dueAt} < ${now} then 1 else 0 end), 0)`,
        today: sql<number>`coalesce(sum(case when ${followUps.dueAt} >= ${today.start} and ${followUps.dueAt} < ${today.end} then 1 else 0 end), 0)`,
      })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .where(and(...followUpConditions)),
    db
      .select({ total: countDistinct(leadTreatmentGovernance.leadId) })
      .from(leadTreatmentGovernance)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadTreatmentGovernance.leadId),
          eq(leads.partnerId, leadTreatmentGovernance.partnerId)
        )
      )
      .where(and(...governanceConditions)),
  ]);
  const stock = leadRows[0];
  const followup = followUpRows[0];
  return {
    available: numberOf(stock?.available),
    inPortfolio: numberOf(stock?.inPortfolio),
    assignedWithoutFirstContact: numberOf(stock?.assignedWithoutFirstContact),
    stale: numberOf(stock?.stale),
    followUpsOverdue: numberOf(followup?.overdue),
    followUpsToday: numberOf(followup?.today),
    governancePending: numberOf(governanceRows[0]?.total),
  };
}

async function queryCampaignAndPdvOverview(
  db: V2Database,
  context: PartnerContext,
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  period: AnalyticsPeriod,
  now: Date
) {
  const cohortConditions = [
    ...analyticsScopeConditions(context, scope, filters),
    gte(leads.receivedAt, period.start),
    lt(leads.receivedAt, period.end),
  ];
  const campaignTerminalEvent = alias(
    leadTimelineEvents,
    "analytics_campaign_terminal_event"
  );
  const campaignTerminalStatus = alias(
    leadStatuses,
    "analytics_campaign_terminal_status"
  );
  const campaignConversionEvent = alias(
    leadTimelineEvents,
    "analytics_campaign_conversion_event"
  );
  const campaignConversionStatus = alias(
    leadStatuses,
    "analytics_campaign_conversion_status"
  );
  const pdvTerminalEvent = alias(
    leadTimelineEvents,
    "analytics_pdv_terminal_event"
  );
  const pdvTerminalStatus = alias(
    leadStatuses,
    "analytics_pdv_terminal_status"
  );
  const pdvConversionEvent = alias(
    leadTimelineEvents,
    "analytics_pdv_conversion_event"
  );
  const pdvConversionStatus = alias(
    leadStatuses,
    "analytics_pdv_conversion_status"
  );
  const followUpConditions = [
    ...analyticsScopeConditions(context, scope, filters),
    eq(followUps.partnerId, context.partnerId),
    eq(followUps.status, "pending"),
    lt(followUps.dueAt, now),
  ];
  // These grouped queries deliberately avoid correlated EXISTS expressions
  // inside SUM. TiDB accepts the joins below and COUNT DISTINCT maintains the
  // metric's one Lead per campaign/PDV semantics.
  const [
    campaignRows,
    campaignTreatedRows,
    campaignCompletedRows,
    campaignConversionRows,
    pdvRows,
    pdvTreatedRows,
    pdvCompletedRows,
    pdvConversionRows,
    campaignOverdue,
    pdvOverdue,
  ] = await Promise.all([
    db
      .select({
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        leads: count(),
        firstContactAverageSeconds: sql<
          number | null
        >`avg(case when ${leads.firstContactAt} is not null and ${leads.firstContactAt} < ${period.end} then timestampdiff(second, ${leads.receivedAt}, ${leads.firstContactAt}) else null end)`,
      })
      .from(leads)
      .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .where(and(...cohortConditions))
      .groupBy(campaigns.id, campaigns.name)
      .orderBy(desc(count()), asc(campaigns.name)),
    db
      .select({ campaignId: leads.campaignId, total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        leadContacts,
        and(
          eq(leadContacts.partnerId, leads.partnerId),
          eq(leadContacts.leadId, leads.id)
        )
      )
      .where(
        and(
          ...cohortConditions,
          eq(leadContacts.partnerId, context.partnerId),
          lt(leadContacts.occurredAt, period.end)
        )
      )
      .groupBy(leads.campaignId),
    db
      .select({ campaignId: leads.campaignId, total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        campaignTerminalEvent,
        and(
          eq(campaignTerminalEvent.partnerId, leads.partnerId),
          eq(campaignTerminalEvent.leadId, leads.id)
        )
      )
      .innerJoin(
        campaignTerminalStatus,
        and(
          sql`${campaignTerminalStatus.id} = cast(json_unquote(json_extract(${campaignTerminalEvent.payloadJson}, '$.statusId')) as unsigned)`,
          eq(campaignTerminalStatus.partnerId, campaignTerminalEvent.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          eq(campaignTerminalEvent.partnerId, context.partnerId),
          eq(campaignTerminalEvent.type, "status_changed"),
          lt(campaignTerminalEvent.occurredAt, period.end),
          eq(campaignTerminalStatus.isTerminal, true)
        )
      )
      .groupBy(leads.campaignId),
    db
      .select({ campaignId: leads.campaignId, total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        campaignConversionEvent,
        and(
          eq(campaignConversionEvent.partnerId, leads.partnerId),
          eq(campaignConversionEvent.leadId, leads.id)
        )
      )
      .innerJoin(
        campaignConversionStatus,
        and(
          sql`${campaignConversionStatus.id} = cast(json_unquote(json_extract(${campaignConversionEvent.payloadJson}, '$.statusId')) as unsigned)`,
          eq(
            campaignConversionStatus.partnerId,
            campaignConversionEvent.partnerId
          )
        )
      )
      .where(
        and(
          ...cohortConditions,
          eq(campaignConversionEvent.partnerId, context.partnerId),
          eq(campaignConversionEvent.type, "status_changed"),
          lt(campaignConversionEvent.occurredAt, period.end),
          eq(campaignConversionStatus.isTerminal, true),
          eq(campaignConversionStatus.category, "completed")
        )
      )
      .groupBy(leads.campaignId),
    db
      .select({
        pdvId: pdvs.id,
        pdvName: pdvs.name,
        leads: count(),
        firstContactAverageSeconds: sql<
          number | null
        >`avg(case when ${leads.firstContactAt} is not null and ${leads.firstContactAt} < ${period.end} then timestampdiff(second, ${leads.receivedAt}, ${leads.firstContactAt}) else null end)`,
      })
      .from(leads)
      .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
      .where(and(...cohortConditions))
      .groupBy(pdvs.id, pdvs.name)
      .orderBy(desc(count()), asc(pdvs.name)),
    db
      .select({ pdvId: leads.pdvId, total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        leadContacts,
        and(
          eq(leadContacts.partnerId, leads.partnerId),
          eq(leadContacts.leadId, leads.id)
        )
      )
      .where(
        and(
          ...cohortConditions,
          eq(leadContacts.partnerId, context.partnerId),
          lt(leadContacts.occurredAt, period.end)
        )
      )
      .groupBy(leads.pdvId),
    db
      .select({ pdvId: leads.pdvId, total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        pdvTerminalEvent,
        and(
          eq(pdvTerminalEvent.partnerId, leads.partnerId),
          eq(pdvTerminalEvent.leadId, leads.id)
        )
      )
      .innerJoin(
        pdvTerminalStatus,
        and(
          sql`${pdvTerminalStatus.id} = cast(json_unquote(json_extract(${pdvTerminalEvent.payloadJson}, '$.statusId')) as unsigned)`,
          eq(pdvTerminalStatus.partnerId, pdvTerminalEvent.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          eq(pdvTerminalEvent.partnerId, context.partnerId),
          eq(pdvTerminalEvent.type, "status_changed"),
          lt(pdvTerminalEvent.occurredAt, period.end),
          eq(pdvTerminalStatus.isTerminal, true)
        )
      )
      .groupBy(leads.pdvId),
    db
      .select({ pdvId: leads.pdvId, total: countDistinct(leads.id) })
      .from(leads)
      .innerJoin(
        pdvConversionEvent,
        and(
          eq(pdvConversionEvent.partnerId, leads.partnerId),
          eq(pdvConversionEvent.leadId, leads.id)
        )
      )
      .innerJoin(
        pdvConversionStatus,
        and(
          sql`${pdvConversionStatus.id} = cast(json_unquote(json_extract(${pdvConversionEvent.payloadJson}, '$.statusId')) as unsigned)`,
          eq(pdvConversionStatus.partnerId, pdvConversionEvent.partnerId)
        )
      )
      .where(
        and(
          ...cohortConditions,
          eq(pdvConversionEvent.partnerId, context.partnerId),
          eq(pdvConversionEvent.type, "status_changed"),
          lt(pdvConversionEvent.occurredAt, period.end),
          eq(pdvConversionStatus.isTerminal, true),
          eq(pdvConversionStatus.category, "completed")
        )
      )
      .groupBy(leads.pdvId),
    db
      .select({ campaignId: leads.campaignId, overdue: count() })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .where(and(...followUpConditions))
      .groupBy(leads.campaignId),
    db
      .select({ pdvId: leads.pdvId, overdue: count() })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .where(and(...followUpConditions))
      .groupBy(leads.pdvId),
  ]);
  const campaignOverdueMap = new Map(
    campaignOverdue.map(row => [row.campaignId, numberOf(row.overdue)])
  );
  const pdvOverdueMap = new Map(
    pdvOverdue.map(row => [row.pdvId, numberOf(row.overdue)])
  );
  const metricsById = (
    treatedRows: Array<{ id: number; total: unknown }>,
    completedRows: Array<{ id: number; total: unknown }>,
    conversionRows: Array<{ id: number; total: unknown }>
  ) => {
    const metrics = new Map<
      number,
      { treated: number; completed: number; converted: number }
    >();
    for (const row of treatedRows) {
      metrics.set(row.id, {
        treated: numberOf(row.total),
        completed: 0,
        converted: 0,
      });
    }
    for (const row of completedRows) {
      const current = metrics.get(row.id) ?? {
        treated: 0,
        completed: 0,
        converted: 0,
      };
      current.completed = numberOf(row.total);
      metrics.set(row.id, current);
    }
    for (const row of conversionRows) {
      const current = metrics.get(row.id) ?? {
        treated: 0,
        completed: 0,
        converted: 0,
      };
      current.converted = numberOf(row.total);
      metrics.set(row.id, current);
    }
    return metrics;
  };
  const campaignMetrics = metricsById(
    campaignTreatedRows.map(row => ({ id: row.campaignId, total: row.total })),
    campaignCompletedRows.map(row => ({
      id: row.campaignId,
      total: row.total,
    })),
    campaignConversionRows.map(row => ({
      id: row.campaignId,
      total: row.total,
    }))
  );
  const pdvMetrics = metricsById(
    pdvTreatedRows.map(row => ({ id: row.pdvId, total: row.total })),
    pdvCompletedRows.map(row => ({ id: row.pdvId, total: row.total })),
    pdvConversionRows.map(row => ({ id: row.pdvId, total: row.total }))
  );
  const normalize = (
    row: {
      leads: unknown;
      firstContactAverageSeconds: unknown;
    },
    metrics:
      | { treated: number; completed: number; converted: number }
      | undefined
  ) => {
    const leadTotal = numberOf(row.leads);
    const values = metrics ?? { treated: 0, completed: 0, converted: 0 };
    return {
      leads: leadTotal,
      treated: values.treated,
      completed: values.completed,
      conversions: values.converted,
      conversionRate: safeRate(values.converted, leadTotal),
      firstContactAverageSeconds:
        row.firstContactAverageSeconds == null
          ? null
          : numberOf(row.firstContactAverageSeconds),
    };
  };
  return {
    campaigns: campaignRows.map(row => ({
      id: row.campaignId,
      name: row.campaignName,
      ...normalize(row, campaignMetrics.get(row.campaignId)),
      followUpsOverdue: campaignOverdueMap.get(row.campaignId) ?? 0,
    })),
    pdvs: pdvRows.map(row => ({
      id: row.pdvId,
      name: row.pdvName,
      ...normalize(row, pdvMetrics.get(row.pdvId)),
      followUpsOverdue: pdvOverdueMap.get(row.pdvId) ?? 0,
    })),
  };
}

/** Central Dashboard query layer. Every count is computed in SQL under the resolved tenant scope. */
export async function getDashboardAnalytics(
  context: PartnerContext,
  filters: AnalyticsFilters
) {
  const analytics = await createAnalyticsContext(context, filters);
  const { db, scope, period, now } = analytics;
  const [cohort, previousCohort, activity, previousActivity, stocks, overview] =
    await Promise.all([
      queryCohortMetrics(db, context, scope, filters, period),
      queryCohortMetrics(db, context, scope, filters, {
        start: period.previousStart,
        end: period.previousEnd,
      }),
      queryPeriodActivityMetrics(db, context, scope, filters, period),
      queryPeriodActivityMetrics(db, context, scope, filters, {
        start: period.previousStart,
        end: period.previousEnd,
      }),
      queryDashboardStocks(
        db,
        context,
        scope,
        filters,
        period,
        now,
        analytics.staleLeadMinutes
      ),
      queryCampaignAndPdvOverview(db, context, scope, filters, period, now),
    ]);
  const conversionRate = safeRate(cohort.converted, cohort.received);
  const previousConversionRate = safeRate(
    previousCohort.converted,
    previousCohort.received
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
      leadsReceived: cohort.received,
      leadsAvailable: stocks.available,
      leadsInPortfolio: stocks.inPortfolio,
      leadsTreated: activity.treated,
      leadsCompleted: activity.completed,
      conversions: activity.converted,
      conversionRate,
      followUpsOverdue: stocks.followUpsOverdue,
      followUpsToday: stocks.followUpsToday,
      firstContactAverageSeconds: activity.firstContactAverageSeconds,
      leadsWithoutFirstContact: stocks.assignedWithoutFirstContact,
    },
    comparisons: {
      leadsReceived: percentageChange(cohort.received, previousCohort.received),
      leadsTreated: percentageChange(
        activity.treated,
        previousActivity.treated
      ),
      leadsCompleted: percentageChange(
        activity.completed,
        previousActivity.completed
      ),
      conversions: percentageChange(
        activity.converted,
        previousActivity.converted
      ),
      conversionRate:
        conversionRate == null || previousConversionRate == null
          ? null
          : percentageChange(conversionRate, previousConversionRate),
    },
    funnel: {
      received: cohort.received,
      assigned: cohort.assigned,
      treated: cohort.treated,
      completed: cohort.completed,
      converted: cohort.converted,
    },
    health: {
      unassigned: stocks.available,
      assignedWithoutFirstContact: stocks.assignedWithoutFirstContact,
      followUpsOverdue: stocks.followUpsOverdue,
      staleLeads: stocks.stale,
      staleLeadMinutes: analytics.staleLeadMinutes,
      governancePending: stocks.governancePending,
    },
    campaigns: overview.campaigns,
    pdvs: overview.pdvs,
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
  if (filters.pdvId) {
    conditions.push(eq(userPdvAssignments.pdvId, filters.pdvId));
  }
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

type MutableProductivity = {
  membershipId: number;
  name: string;
  pdvIds: number[];
  pdvNames: string[];
  leadsInPortfolio: number;
  leadsAssignedInPeriod: number;
  leadsTreated: number;
  contacts: number;
  leadsCompleted: number;
  conversions: number;
  followUpsCreated: number;
  followUpsCompleted: number;
  followUpsOverdue: number;
  followUpsPending: number;
  followUpsDueByPeriodEnd: number;
  firstContactAverageSeconds: number | null;
  leadsWithoutFirstContact: number;
  lastActivityAt: Date | null;
  governanceComplete: number;
  governancePending: number;
};

function createProductivityRow(seller: AnalyticsSeller): MutableProductivity {
  return {
    membershipId: seller.membershipId,
    name: seller.name,
    pdvIds: seller.pdvIds,
    pdvNames: seller.pdvNames,
    leadsInPortfolio: 0,
    leadsAssignedInPeriod: 0,
    leadsTreated: 0,
    contacts: 0,
    leadsCompleted: 0,
    conversions: 0,
    followUpsCreated: 0,
    followUpsCompleted: 0,
    followUpsOverdue: 0,
    followUpsPending: 0,
    followUpsDueByPeriodEnd: 0,
    firstContactAverageSeconds: null,
    leadsWithoutFirstContact: 0,
    lastActivityAt: null,
    governanceComplete: 0,
    governancePending: 0,
  };
}

function addToRows<T extends { membershipId: number }>(
  source: readonly T[],
  target: Map<number, MutableProductivity>,
  apply: (target: MutableProductivity, row: T) => void
) {
  for (const row of source) {
    const existing = target.get(row.membershipId);
    if (existing) apply(existing, row);
  }
}

/** Productivity is intentionally separated from Dashboard stocks and credits actual contact/follow-up actors. */
export async function getProductivityAnalytics(
  context: PartnerContext,
  filters: AnalyticsFilters
) {
  const analytics = await createAnalyticsContext(context, filters);
  const { db, scope, period, now } = analytics;
  const sellers = await listAnalyticsSellers(db, context, scope, filters);
  const bySeller = new Map(
    sellers.map(seller => [seller.membershipId, createProductivityRow(seller)])
  );
  if (!sellers.length) {
    return {
      period: {
        start: period.start,
        end: period.end,
        timeZone: period.timeZone,
        label: period.label,
      },
      totals: { sellers: 0, contacts: 0, treated: 0, followUpsOverdue: 0 },
      sellers: [],
    };
  }
  const sellerIds = sellers.map(seller => seller.membershipId);
  const leadConditions = analyticsScopeConditions(context, scope, filters, {
    includeOwner: false,
  });
  const activeLeadConditions = [
    ...leadConditions,
    inArray(leads.assignedMembershipId, sellerIds),
    inArray(leadStatuses.category, ["open", "in_progress"]),
  ];
  const contactConditions = [
    ...leadConditions,
    eq(leadContacts.partnerId, context.partnerId),
    inArray(leadContacts.actorMembershipId, sellerIds),
    gte(leadContacts.occurredAt, period.start),
    lt(leadContacts.occurredAt, period.end),
  ];
  const event = alias(leadTimelineEvents, "productivity_status_event");
  const targetStatus = alias(leadStatuses, "productivity_target_status");
  const statusEventConditions = [
    ...leadConditions,
    eq(event.partnerId, context.partnerId),
    inArray(event.actorMembershipId, sellerIds),
    eq(event.type, "status_changed"),
    gte(event.occurredAt, period.start),
    lt(event.occurredAt, period.end),
  ];
  const followUpConditions = [
    ...leadConditions,
    eq(followUps.partnerId, context.partnerId),
    inArray(followUps.ownerMembershipId, sellerIds),
  ];
  const firstContact = alias(leadContacts, "productivity_first_contact");
  const governanceEvent = alias(
    leadTimelineEvents,
    "productivity_governance_event"
  );
  const [
    portfolio,
    assigned,
    contacts,
    completed,
    conversions,
    followupRows,
    firstContacts,
    lastActivity,
    governance,
  ] = await Promise.all([
    db
      .select({
        membershipId: leads.assignedMembershipId,
        total: count(),
        withoutFirstContact: sql<number>`coalesce(sum(case when ${leads.firstContactAt} is null then 1 else 0 end), 0)`,
      })
      .from(leads)
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .where(and(...activeLeadConditions))
      .groupBy(leads.assignedMembershipId),
    db
      .select({ membershipId: leads.assignedMembershipId, total: count() })
      .from(leads)
      .where(
        and(
          ...leadConditions,
          inArray(leads.assignedMembershipId, sellerIds),
          isNotNull(leads.assignedAt),
          gte(leads.assignedAt, period.start),
          lt(leads.assignedAt, period.end)
        )
      )
      .groupBy(leads.assignedMembershipId),
    db
      .select({
        membershipId: leadContacts.actorMembershipId,
        contacts: count(),
        treated: countDistinct(leadContacts.leadId),
      })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .where(and(...contactConditions))
      .groupBy(leadContacts.actorMembershipId),
    db
      .select({
        membershipId: event.actorMembershipId,
        total: countDistinct(event.leadId),
      })
      .from(event)
      .innerJoin(
        leads,
        and(eq(leads.id, event.leadId), eq(leads.partnerId, event.partnerId))
      )
      .innerJoin(
        targetStatus,
        and(
          sql`${targetStatus.id} = cast(json_unquote(json_extract(${event.payloadJson}, '$.statusId')) as unsigned)`,
          eq(targetStatus.partnerId, event.partnerId)
        )
      )
      .where(and(...statusEventConditions, eq(targetStatus.isTerminal, true)))
      .groupBy(event.actorMembershipId),
    db
      .select({
        membershipId: event.actorMembershipId,
        total: countDistinct(event.leadId),
      })
      .from(event)
      .innerJoin(
        leads,
        and(eq(leads.id, event.leadId), eq(leads.partnerId, event.partnerId))
      )
      .innerJoin(
        targetStatus,
        and(
          sql`${targetStatus.id} = cast(json_unquote(json_extract(${event.payloadJson}, '$.statusId')) as unsigned)`,
          eq(targetStatus.partnerId, event.partnerId)
        )
      )
      .where(
        and(
          ...statusEventConditions,
          eq(targetStatus.isTerminal, true),
          eq(targetStatus.category, "completed")
        )
      )
      .groupBy(event.actorMembershipId),
    db
      .select({
        membershipId: followUps.ownerMembershipId,
        created: sql<number>`coalesce(sum(case when ${followUps.createdAt} >= ${period.start} and ${followUps.createdAt} < ${period.end} then 1 else 0 end), 0)`,
        completed: sql<number>`coalesce(sum(case when ${followUps.completedAt} >= ${period.start} and ${followUps.completedAt} < ${period.end} then 1 else 0 end), 0)`,
        overdue: sql<number>`coalesce(sum(case when ${followUps.status} = 'pending' and ${followUps.dueAt} < ${now} then 1 else 0 end), 0)`,
        pending: sql<number>`coalesce(sum(case when ${followUps.status} = 'pending' then 1 else 0 end), 0)`,
        dueByEnd: sql<number>`coalesce(sum(case when ${followUps.status} = 'pending' and ${followUps.dueAt} < ${period.end} then 1 else 0 end), 0)`,
      })
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .where(and(...followUpConditions))
      .groupBy(followUps.ownerMembershipId),
    db
      .select({
        membershipId: firstContact.actorMembershipId,
        averageSeconds: sql<
          number | null
        >`avg(timestampdiff(second, ${leads.receivedAt}, ${leads.firstContactAt}))`,
      })
      .from(leads)
      .innerJoin(
        firstContact,
        and(
          eq(firstContact.leadId, leads.id),
          eq(firstContact.partnerId, leads.partnerId),
          eq(firstContact.occurredAt, leads.firstContactAt)
        )
      )
      .where(
        and(
          ...leadConditions,
          inArray(firstContact.actorMembershipId, sellerIds),
          isNotNull(leads.firstContactAt),
          gte(leads.firstContactAt, period.start),
          lt(leads.firstContactAt, period.end)
        )
      )
      .groupBy(firstContact.actorMembershipId),
    db
      .select({
        membershipId: leads.assignedMembershipId,
        lastActivityAt: max(leads.lastActivityAt),
      })
      .from(leads)
      .where(
        and(...leadConditions, inArray(leads.assignedMembershipId, sellerIds))
      )
      .groupBy(leads.assignedMembershipId),
    db
      .select({
        membershipId: governanceEvent.actorMembershipId,
        complete: sql<number>`coalesce(sum(case when ${leadTreatmentGovernance.isComplete} = true then 1 else 0 end), 0)`,
        pending: sql<number>`coalesce(sum(case when ${leadTreatmentGovernance.isComplete} = false then 1 else 0 end), 0)`,
      })
      .from(leadTreatmentGovernance)
      .innerJoin(
        governanceEvent,
        and(
          eq(governanceEvent.id, leadTreatmentGovernance.timelineEventId),
          eq(governanceEvent.partnerId, leadTreatmentGovernance.partnerId),
          eq(governanceEvent.leadId, leadTreatmentGovernance.leadId)
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
          inArray(governanceEvent.actorMembershipId, sellerIds),
          gte(governanceEvent.occurredAt, period.start),
          lt(governanceEvent.occurredAt, period.end)
        )
      )
      .groupBy(governanceEvent.actorMembershipId),
  ]);

  addToRows(
    portfolio.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.leadsInPortfolio = numberOf(row.total);
      target.leadsWithoutFirstContact = numberOf(row.withoutFirstContact);
    }
  );
  addToRows(
    assigned.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.leadsAssignedInPeriod = numberOf(row.total);
    }
  );
  addToRows(contacts, bySeller, (target, row) => {
    target.contacts = numberOf(row.contacts);
    target.leadsTreated = numberOf(row.treated);
  });
  addToRows(
    completed.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.leadsCompleted = numberOf(row.total);
    }
  );
  addToRows(
    conversions.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.conversions = numberOf(row.total);
    }
  );
  addToRows(followupRows, bySeller, (target, row) => {
    target.followUpsCreated = numberOf(row.created);
    target.followUpsCompleted = numberOf(row.completed);
    target.followUpsOverdue = numberOf(row.overdue);
    target.followUpsPending = numberOf(row.pending);
    target.followUpsDueByPeriodEnd = numberOf(row.dueByEnd);
  });
  addToRows(firstContacts, bySeller, (target, row) => {
    target.firstContactAverageSeconds =
      row.averageSeconds == null ? null : numberOf(row.averageSeconds);
  });
  addToRows(
    lastActivity.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.lastActivityAt = row.lastActivityAt;
    }
  );
  addToRows(
    governance.filter(
      (row): row is typeof row & { membershipId: number } =>
        row.membershipId !== null
    ),
    bySeller,
    (target, row) => {
      target.governanceComplete = numberOf(row.complete);
      target.governancePending = numberOf(row.pending);
    }
  );

  const rows = Array.from(bySeller.values()).map(row => ({
    ...row,
    treatmentRate: safeRate(row.leadsTreated, row.leadsAssignedInPeriod),
    followUpCompletionRate: safeRate(
      row.followUpsCompleted,
      row.followUpsCompleted + row.followUpsDueByPeriodEnd
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
      contacts: rows.reduce((total, row) => total + row.contacts, 0),
      treated: rows.reduce((total, row) => total + row.leadsTreated, 0),
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
  const campaignsById = new Map(campaignRows.map(row => [row.id, row]));
  return {
    timeZone: period.timeZone,
    campaigns: Array.from(campaignsById.values()),
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

function timelineStatusId(payload: unknown) {
  let value: unknown = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || !("statusId" in value)) {
    return null;
  }
  const statusId = Number((value as { statusId?: unknown }).statusId);
  return Number.isInteger(statusId) && statusId > 0 ? statusId : null;
}

function leadReportColumns(
  customFields: Array<{ key: string; label: string }>
) {
  return [
    { key: "id", label: "Identificador" },
    { key: "campaign", label: "Campanha" },
    { key: "pdv", label: "PDV" },
    { key: "responsible", label: "Responsável" },
    { key: "name", label: "Nome" },
    { key: "phone", label: "Telefone" },
    { key: "email", label: "E-mail" },
    { key: "status", label: "Status" },
    { key: "source", label: "Origem" },
    { key: "receivedAt", label: "Recebido em" },
    { key: "assignedAt", label: "Atribuído em" },
    { key: "firstContactAt", label: "Primeiro contato" },
    { key: "lastActivityAt", label: "Última atividade" },
    { key: "nextFollowUpAt", label: "Próximo follow-up pendente" },
    { key: "completed", label: "Concluído" },
    { key: "concludedAt", label: "Concluído em" },
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
    ...analyticsScopeConditions(context, scope, input),
    gte(leads.receivedAt, period.start),
    lt(leads.receivedAt, period.end),
  ];
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
          eq(customFieldDefinitions.entityType, "lead")
        )
      )
      .orderBy(
        asc(customFieldDefinitions.sortOrder),
        asc(customFieldDefinitions.id)
      ),
    db
      .select({
        id: leads.id,
        campaign: campaigns.name,
        pdv: pdvs.name,
        responsible: users.name,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        status: leadStatuses.label,
        statusTerminal: leadStatuses.isTerminal,
        source: leadSources.label,
        receivedAt: leads.receivedAt,
        assignedAt: leads.assignedAt,
        firstContactAt: leads.firstContactAt,
        lastActivityAt: leads.lastActivityAt,
        customData: leads.customData,
      })
      .from(leads)
      .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .leftJoin(
        userPartners,
        and(
          eq(userPartners.id, leads.assignedMembershipId),
          eq(userPartners.partnerId, leads.partnerId)
        )
      )
      .leftJoin(users, eq(users.id, userPartners.userId))
      .where(and(...conditions))
      .orderBy(desc(leads.receivedAt), desc(leads.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ total: count() })
      .from(leads)
      .where(and(...conditions)),
  ]);
  const leadIds = records.map(record => record.id);
  const [nextFollowUps, terminalStatuses, terminalEvents] = leadIds.length
    ? await Promise.all([
        db
          .select({
            leadId: followUps.leadId,
            dueAt: min(followUps.dueAt),
          })
          .from(followUps)
          .where(
            and(
              eq(followUps.partnerId, context.partnerId),
              inArray(followUps.leadId, leadIds),
              eq(followUps.status, "pending")
            )
          )
          .groupBy(followUps.leadId),
        db
          .select({ id: leadStatuses.id })
          .from(leadStatuses)
          .where(
            and(
              eq(leadStatuses.partnerId, context.partnerId),
              eq(leadStatuses.isTerminal, true)
            )
          ),
        db
          .select({
            leadId: leadTimelineEvents.leadId,
            occurredAt: leadTimelineEvents.occurredAt,
            payloadJson: leadTimelineEvents.payloadJson,
          })
          .from(leadTimelineEvents)
          .where(
            and(
              eq(leadTimelineEvents.partnerId, context.partnerId),
              eq(leadTimelineEvents.type, "status_changed"),
              inArray(leadTimelineEvents.leadId, leadIds)
            )
          )
          .orderBy(
            desc(leadTimelineEvents.occurredAt),
            desc(leadTimelineEvents.id)
          ),
      ])
    : [[], [], []];
  const nextFollowUpByLead = new Map(
    nextFollowUps.map(row => [row.leadId, row.dueAt])
  );
  const terminalStatusIds = new Set(terminalStatuses.map(row => row.id));
  const concludedAtByLead = new Map<number, Date>();
  for (const event of terminalEvents) {
    const statusId = timelineStatusId(event.payloadJson);
    if (statusId && terminalStatusIds.has(statusId)) {
      concludedAtByLead.set(event.leadId, event.occurredAt);
    }
  }
  const columns = leadReportColumns(customFields);
  return {
    columns,
    rows: records.map(record => {
      const customData =
        record.customData && typeof record.customData === "object"
          ? (record.customData as Record<string, unknown>)
          : {};
      return {
        id: record.id,
        campaign: record.campaign,
        pdv: record.pdv,
        responsible: record.responsible ?? "Sem responsável",
        name: record.name ?? "",
        phone: record.phone ?? "",
        email: record.email ?? "",
        status: record.status,
        source: record.source ?? "",
        receivedAt: valueOfDate(record.receivedAt),
        assignedAt: valueOfDate(record.assignedAt),
        firstContactAt: valueOfDate(record.firstContactAt),
        lastActivityAt: valueOfDate(record.lastActivityAt),
        nextFollowUpAt: valueOfDate(nextFollowUpByLead.get(record.id)),
        completed: record.statusTerminal ? "Sim" : "Não",
        concludedAt: valueOfDate(concludedAtByLead.get(record.id)),
        ...Object.fromEntries(
          customFields.map(field => [
            `custom_${field.key}`,
            customFieldValue(customData[field.key]),
          ])
        ),
      } as AnalyticsReportRow;
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
    ...analyticsScopeConditions(context, scope, input),
    eq(leadContacts.partnerId, context.partnerId),
    gte(leadContacts.occurredAt, period.start),
    lt(leadContacts.occurredAt, period.end),
  ];
  const evidence = alias(leadEvidences, "report_treatment_evidence");
  const columns: AnalyticsReportColumn[] = [
    { key: "lead", label: "Lead" },
    { key: "campaign", label: "Campanha" },
    { key: "pdv", label: "PDV" },
    { key: "seller", label: "Vendedor" },
    { key: "occurredAt", label: "Data/hora" },
    { key: "channel", label: "Canal" },
    { key: "outcome", label: "Resultado" },
    { key: "summary", label: "Resumo" },
    { key: "status", label: "Status atual" },
    { key: "hasEvidence", label: "Evidência existente" },
  ];
  const [records, totals] = await Promise.all([
    db
      .select({
        lead: leads.name,
        campaign: campaigns.name,
        pdv: pdvs.name,
        seller: users.name,
        occurredAt: leadContacts.occurredAt,
        channel: leadContacts.channel,
        outcome: leadContacts.outcome,
        summary: leadContacts.summary,
        status: leadStatuses.label,
        hasEvidence: sql<number>`case when exists (
          select 1 from ${evidence}
          where ${evidence.partnerId} = ${leads.partnerId}
            and ${evidence.leadId} = ${leads.id}
            and ${evidence.deletedAt} is null
            and ${evidence.storageStatus} = 'available'
        ) then 1 else 0 end`,
      })
      .from(leadContacts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, leadContacts.leadId),
          eq(leads.partnerId, leadContacts.partnerId)
        )
      )
      .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .innerJoin(
        userPartners,
        and(
          eq(userPartners.id, leadContacts.actorMembershipId),
          eq(userPartners.partnerId, leadContacts.partnerId)
        )
      )
      .innerJoin(users, eq(users.id, userPartners.userId))
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
    columns,
    rows: records.map(record => ({
      lead: record.lead ?? "Lead sem nome",
      campaign: record.campaign,
      pdv: record.pdv,
      seller: record.seller,
      occurredAt: valueOfDate(record.occurredAt),
      channel: record.channel,
      outcome: record.outcome,
      summary: record.summary ?? "",
      status: record.status,
      hasEvidence: numberOf(record.hasEvidence) ? "Sim" : "Não",
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
    ...analyticsScopeConditions(context, scope, input),
    eq(followUps.partnerId, context.partnerId),
    gte(followUps.dueAt, period.start),
    lt(followUps.dueAt, period.end),
  ];
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
    { key: "origin", label: "Origem/reagendamento" },
  ];
  const select = {
    lead: leads.name,
    responsible: users.name,
    pdv: pdvs.name,
    campaign: campaigns.name,
    createdAt: followUps.createdAt,
    dueAt: followUps.dueAt,
    status: followUps.status,
    completedAt: followUps.completedAt,
    cancelledAt: followUps.cancelledAt,
    rescheduledFromId: followUps.rescheduledFromId,
  };
  const [records, totals] = await Promise.all([
    db
      .select(select)
      .from(followUps)
      .innerJoin(
        leads,
        and(
          eq(leads.id, followUps.leadId),
          eq(leads.partnerId, followUps.partnerId)
        )
      )
      .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .innerJoin(pdvs, eq(pdvs.id, leads.pdvId))
      .innerJoin(
        userPartners,
        and(
          eq(userPartners.id, followUps.ownerMembershipId),
          eq(userPartners.partnerId, followUps.partnerId)
        )
      )
      .innerJoin(users, eq(users.id, userPartners.userId))
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
        ? `Reagendado do follow-up #${record.rescheduledFromId}`
        : "Original",
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
  // A batch without a fixed destination can contain multiple PDVs. It is not
  // shown to a Manager because its aggregate counts cannot be safely split.
  if (scope.pdvIds)
    conditions.push(inArray(leadImportBatches.targetPdvId, scope.pdvIds));
  const columns: AnalyticsReportColumn[] = [
    { key: "batch", label: "Batch" },
    { key: "campaign", label: "Campanha" },
    { key: "fileName", label: "Arquivo" },
    { key: "user", label: "Usuário" },
    { key: "template", label: "Template" },
    { key: "version", label: "Versão" },
    { key: "total", label: "Total" },
    { key: "valid", label: "Válidos" },
    { key: "invalid", label: "Inválidos" },
    { key: "imported", label: "Importados" },
    { key: "duplicates", label: "Duplicados" },
    { key: "rejected", label: "Rejeitados" },
    { key: "status", label: "Status" },
    { key: "createdAt", label: "Data" },
  ];
  const [records, totals] = await Promise.all([
    db
      .select({
        batch: leadImportBatches.id,
        campaign: campaigns.name,
        fileName: leadImportBatches.fileName,
        user: users.name,
        template: importTemplates.name,
        version: importTemplateVersions.versionNumber,
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
      .innerJoin(campaigns, eq(campaigns.id, leadImportBatches.campaignId))
      .leftJoin(
        userPartners,
        and(
          eq(userPartners.id, leadImportBatches.importedByMembershipId),
          eq(userPartners.partnerId, leadImportBatches.partnerId)
        )
      )
      .leftJoin(users, eq(users.id, userPartners.userId))
      .leftJoin(
        importTemplateVersions,
        and(
          eq(importTemplateVersions.id, leadImportBatches.templateVersionId),
          eq(importTemplateVersions.partnerId, leadImportBatches.partnerId)
        )
      )
      .leftJoin(
        importTemplates,
        and(
          eq(importTemplates.id, importTemplateVersions.templateId),
          eq(importTemplates.partnerId, importTemplateVersions.partnerId)
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
  return {
    columns,
    rows: records.map(record => ({
      batch: record.batch,
      campaign: record.campaign,
      fileName: record.fileName,
      user: record.user ?? "",
      template: record.template ?? "",
      version: record.version ?? "",
      total: record.total,
      valid: record.valid,
      invalid: record.invalid,
      imported: record.imported,
      duplicates: record.duplicates,
      rejected: record.rejected,
      status: record.status,
      createdAt: valueOfDate(record.createdAt),
    })),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

function distributionPdvNames() {
  const event = alias(leadTimelineEvents, "report_distribution_pdv_event");
  const distributedLead = alias(leads, "report_distribution_pdv_lead");
  const distributionPdv = alias(pdvs, "report_distribution_pdv");
  return sql<string | null>`(
    select group_concat(distinct ${distributionPdv.name} order by ${distributionPdv.name} separator ', ')
    from ${event}
    inner join ${distributedLead}
      on ${distributedLead.id} = ${event.leadId}
      and ${distributedLead.partnerId} = ${event.partnerId}
    inner join ${distributionPdv}
      on ${distributionPdv.id} = ${distributedLead.pdvId}
      and ${distributionPdv.partnerId} = ${distributedLead.partnerId}
    where ${event.partnerId} = ${leadDistributionBatches.partnerId}
      and cast(json_unquote(json_extract(${event.payloadJson}, '$.batchId')) as unsigned) = ${leadDistributionBatches.id}
  )`;
}

function distributionBatchScopeCondition(
  scope: AnalyticsScope,
  selectedPdvId?: number
) {
  const event = alias(leadTimelineEvents, "report_distribution_scope_event");
  const distributedLead = alias(leads, "report_distribution_scope_lead");
  const targetPdvIds = selectedPdvId ? [selectedPdvId] : scope.pdvIds;
  if (!targetPdvIds) return null;
  const isInsideScope = inArray(distributedLead.pdvId, targetPdvIds);
  const isOutsideScope = notInArray(distributedLead.pdvId, targetPdvIds);
  // Batch totals are only exposed when every successful event belongs to the
  // caller's PDV filter. This avoids leaking a mixed-PDV batch total.
  return sql`exists (
    select 1 from ${event}
    inner join ${distributedLead}
      on ${distributedLead.id} = ${event.leadId}
      and ${distributedLead.partnerId} = ${event.partnerId}
    where ${event.partnerId} = ${leadDistributionBatches.partnerId}
      and cast(json_unquote(json_extract(${event.payloadJson}, '$.batchId')) as unsigned) = ${leadDistributionBatches.id}
      and ${isInsideScope}
  ) and not exists (
    select 1 from ${event}
    inner join ${distributedLead}
      on ${distributedLead.id} = ${event.leadId}
      and ${distributedLead.partnerId} = ${event.partnerId}
    where ${event.partnerId} = ${leadDistributionBatches.partnerId}
      and cast(json_unquote(json_extract(${event.payloadJson}, '$.batchId')) as unsigned) = ${leadDistributionBatches.id}
      and ${isOutsideScope}
  )`;
}

async function listDistributionReport(
  analytics: AnalyticsContext,
  context: PartnerContext,
  input: AnalyticsReportInput,
  maximum: number
) {
  const { db, scope, period } = analytics;
  const pagination = reportPagination(input, maximum);
  const conditions: SQL[] = [
    eq(leadDistributionBatches.partnerId, context.partnerId),
    gte(leadDistributionBatches.createdAt, period.start),
    lt(leadDistributionBatches.createdAt, period.end),
  ];
  if (input.campaignId)
    conditions.push(eq(leadDistributionBatches.campaignId, input.campaignId));
  const scopeCondition = distributionBatchScopeCondition(scope, input.pdvId);
  if (scopeCondition) conditions.push(scopeCondition);
  const columns: AnalyticsReportColumn[] = [
    { key: "operation", label: "Operação" },
    { key: "campaign", label: "Campanha" },
    { key: "pdvs", label: "PDV(s)" },
    { key: "actor", label: "Ator" },
    { key: "strategy", label: "Estratégia" },
    { key: "requested", label: "Solicitados" },
    { key: "processed", label: "Processados" },
    { key: "success", label: "Sucesso" },
    { key: "skipped", label: "Ignorados" },
    { key: "failed", label: "Falhas" },
    { key: "createdAt", label: "Data" },
  ];
  const [records, totals] = await Promise.all([
    db
      .select({
        operation: leadDistributionBatches.type,
        campaign: campaigns.name,
        pdvs: distributionPdvNames(),
        actor: users.name,
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
        eq(campaigns.id, leadDistributionBatches.campaignId)
      )
      .innerJoin(users, eq(users.id, leadDistributionBatches.actorUserId))
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
  return {
    columns,
    rows: records.map(record => ({
      operation: record.operation,
      campaign: record.campaign,
      pdvs: record.pdvs ?? "Sem Leads processados",
      actor: record.actor,
      strategy: record.strategy,
      requested: record.requested,
      processed: record.processed,
      success: record.success,
      skipped: record.skipped,
      failed: record.failed,
      createdAt: valueOfDate(record.createdAt),
    })),
    total: numberOf(totals[0]?.total),
    ...pagination,
  };
}

/** SQL-paginated report registry. None of these data sets is loaded in the browser before filtering. */
export async function listAnalyticsReport(
  context: PartnerContext,
  input: AnalyticsReportInput,
  options: { maximum?: number } = {}
): Promise<AnalyticsReportPage> {
  if (
    context.role === "seller" &&
    (input.type === "imports" || input.type === "distributions")
  ) {
    throw new Error("Este relatório é destinado à gestão do parceiro");
  }
  const analytics = await createAnalyticsContext(context, input);
  const maximum = options.maximum ?? REPORT_PAGE_MAX;
  let result:
    | Awaited<ReturnType<typeof listLeadsReport>>
    | Awaited<ReturnType<typeof listTreatmentReport>>
    | Awaited<ReturnType<typeof listFollowUpReport>>
    | Awaited<ReturnType<typeof listImportReport>>
    | Awaited<ReturnType<typeof listDistributionReport>>;
  if (input.type === "leads") {
    result = await listLeadsReport(analytics, context, input, maximum);
  } else if (input.type === "treatments") {
    result = await listTreatmentReport(analytics, context, input, maximum);
  } else if (input.type === "follow_ups") {
    result = await listFollowUpReport(analytics, context, input, maximum);
  } else if (input.type === "imports") {
    result = await listImportReport(analytics, context, input, maximum);
  } else {
    result = await listDistributionReport(analytics, context, input, maximum);
  }
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
  // Prevent a value imported from a lead from being evaluated as an Excel formula.
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

/** Export calls the same scoped SQL report provider and records only safe audit metadata. */
export async function exportAnalyticsReport(
  context: PartnerContext,
  input: Omit<AnalyticsReportInput, "page" | "pageSize">
) {
  const report = await listAnalyticsReport(
    context,
    { ...input, page: 1, pageSize: EXPORT_ROW_MAX },
    { maximum: EXPORT_ROW_MAX }
  );
  if (report.total > EXPORT_ROW_MAX) {
    throw new Error(
      `A exportação encontrou mais de ${EXPORT_ROW_MAX} linhas. Refine os filtros antes de exportar.`
    );
  }
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
    fileName: `playcell-v2-${input.type}-${from}-${until}.csv`,
    content: formatAnalyticsCsv(report.columns, report.rows),
    total: report.rows.length,
  };
}
