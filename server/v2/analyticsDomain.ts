export type AnalyticsPeriodPreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "this_week"
  | "this_month"
  | "custom";

export type AnalyticsDateRangeInput = {
  preset?: AnalyticsPeriodPreset;
  fromDate?: string;
  toDate?: string;
};

export type AnalyticsPeriod = {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  timeZone: string;
  label: string;
};

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * These definitions are the sole business vocabulary used by the V2 analytics
 * service. They deliberately distinguish stock indicators ("agora") from
 * flow indicators ("no período") so a date filter cannot imply history that
 * the operational model does not retain.
 */
export const analyticsMetricDefinitions = {
  leadsReceived:
    "Leads cuja receivedAt pertence ao período operacional selecionado.",
  leadsAvailable:
    "Snapshot atual: leads sem assignedMembershipId, não excluídos, com status open/in_progress e campanha/PDV operacionalmente ativos dentro do escopo.",
  leadsInPortfolio:
    "Snapshot atual: leads com assignedMembershipId, não excluídos e status open/in_progress dentro do escopo.",
  leadsTreated:
    "Leads distintos com ao menos um lead_contact válido ocorrido no período; status sozinho nunca conta como tratativa.",
  leadsCompleted:
    "Leads distintos com uma mudança de status para um status terminal no período. O evento da timeline é a fonte temporal.",
  conversions:
    "Leads distintos com mudança de status para um status terminal da categoria completed no período. Estados de descarte pertencem à categoria discarded e não convertem.",
  firstContact:
    "Primeiro lead_contact válido, persistido em leads.firstContactAt. Leads ainda sem primeiro contato não recebem duração zero.",
  firstContactTime:
    "Média de firstContactAt - receivedAt apenas para Leads cujo primeiro contato ocorreu no período.",
  followUpOverdue:
    "Snapshot atual derivado de follow_ups.status = pending e dueAt < agora; overdue nunca é persistido.",
  followUpToday:
    "Snapshot atual derivado de follow_ups.status = pending e dueAt dentro do dia operacional do parceiro.",
  treatmentRate:
    "Leads recebidos no período que possuem ao menos um contato até o fim do período, divididos pelos Leads recebidos no período.",
  followUpCompletionRate:
    "Follow-ups concluídos no período divididos por concluídos no período mais pendentes com vencimento até o fim do período. Cancelados não entram no denominador.",
} as const;

function partsAt(date: Date, timeZone: string): Parts {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) =>
    Number(values.find(value => value.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function zonedLocalToUtc(parts: Parts, timeZone: string) {
  const provisional = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const actual = partsAt(new Date(provisional), timeZone);
  const offset =
    Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    ) - provisional;
  return new Date(provisional - offset);
}

function startOfPartnerDay(
  parts: Pick<Parts, "year" | "month" | "day">,
  timeZone: string
) {
  return zonedLocalToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

function addCalendarDays(
  parts: Pick<Parts, "year" | "month" | "day">,
  amount: number
) {
  const next = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + amount)
  );
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function parseDateOnly(value: string) {
  if (!DATE_ONLY.test(value)) throw new Error("Período analítico inválido");
  const [year, month, day] = value.split("-").map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() + 1 !== month ||
    checked.getUTCDate() !== day
  ) {
    throw new Error("Período analítico inválido");
  }
  return { year, month, day };
}

function asIsoDate(parts: Pick<Parts, "year" | "month" | "day">) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * Resolves date-only filters on the server using partner_settings.timezone.
 * The comparison interval is [start, end), so adjacent periods never double
 * count events. The previous comparison range has the identical elapsed span.
 */
export function resolveAnalyticsPeriod(
  timeZone: string,
  input: AnalyticsDateRangeInput = {},
  now = new Date()
): AnalyticsPeriod {
  const current = partsAt(now, timeZone);
  const today = { year: current.year, month: current.month, day: current.day };
  const preset = input.preset ?? "this_month";
  let startParts: Pick<Parts, "year" | "month" | "day">;
  let endParts: Pick<Parts, "year" | "month" | "day">;
  let label: string;

  if (preset === "custom") {
    if (!input.fromDate || !input.toDate)
      throw new Error("Informe início e fim do período personalizado");
    startParts = parseDateOnly(input.fromDate);
    endParts = addCalendarDays(parseDateOnly(input.toDate), 1);
    if (
      startOfPartnerDay(startParts, timeZone) >=
      startOfPartnerDay(endParts, timeZone)
    )
      throw new Error("O início do período deve ser anterior ao fim");
    label = `${input.fromDate} a ${input.toDate}`;
  } else if (preset === "today") {
    startParts = today;
    endParts = addCalendarDays(today, 1);
    label = "Hoje";
  } else if (preset === "yesterday") {
    startParts = addCalendarDays(today, -1);
    endParts = today;
    label = "Ontem";
  } else if (preset === "last_7_days") {
    startParts = addCalendarDays(today, -6);
    endParts = addCalendarDays(today, 1);
    label = "Últimos 7 dias";
  } else if (preset === "this_week") {
    const weekday = new Date(
      Date.UTC(today.year, today.month - 1, today.day)
    ).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    startParts = addCalendarDays(today, -daysSinceMonday);
    endParts = addCalendarDays(today, 1);
    label = "Esta semana";
  } else {
    startParts = { year: today.year, month: today.month, day: 1 };
    endParts = addCalendarDays(today, 1);
    label = "Este mês";
  }

  const start = startOfPartnerDay(startParts, timeZone);
  const end = startOfPartnerDay(endParts, timeZone);
  const duration = end.getTime() - start.getTime();
  return {
    start,
    end,
    previousStart: new Date(start.getTime() - duration),
    previousEnd: start,
    timeZone,
    label,
  };
}

export function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

export function percentageChange(current: number, previous: number) {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export function durationLabel(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const days = Math.floor(rounded / 86_400);
  const hours = Math.floor((rounded % 86_400) / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

export function dateForAnalyticsInput(date: Date, timeZone: string) {
  return asIsoDate(partsAt(date, timeZone));
}

/** Deterministic mirror of the SQL definitions, used to test the metric math. */
export type AnalyticsMetricLead = {
  receivedAt: Date;
  operational: boolean;
  assigned: boolean;
  firstContactAt?: Date | null;
  contactDates: Date[];
  assignmentDates: Date[];
  terminalDates: Date[];
  conversionDates: Date[];
  lastActivityAt?: Date | null;
};

export type AnalyticsMetricFollowUp = {
  status: "pending" | "completed" | "cancelled";
  dueAt: Date;
};

function isInPeriod(
  value: Date,
  period: Pick<AnalyticsPeriod, "start" | "end">
) {
  return value >= period.start && value < period.end;
}

export function calculateAnalyticsMetricSamples(
  leads: AnalyticsMetricLead[],
  followUps: AnalyticsMetricFollowUp[],
  period: Pick<AnalyticsPeriod, "start" | "end">,
  now: Date
) {
  const cohort = leads.filter(lead => isInPeriod(lead.receivedAt, period));
  const firstContactValues = leads
    .filter(
      lead => lead.firstContactAt && isInPeriod(lead.firstContactAt, period)
    )
    .map(
      lead =>
        (lead.firstContactAt!.getTime() - lead.receivedAt.getTime()) / 1_000
    );
  const average = firstContactValues.length
    ? firstContactValues.reduce((total, value) => total + value, 0) /
      firstContactValues.length
    : null;
  return {
    received: cohort.length,
    available: leads.filter(lead => lead.operational && !lead.assigned).length,
    portfolio: leads.filter(lead => lead.operational && lead.assigned).length,
    treated: leads.filter(lead =>
      lead.contactDates.some(date => isInPeriod(date, period))
    ).length,
    completed: leads.filter(lead =>
      lead.terminalDates.some(date => isInPeriod(date, period))
    ).length,
    converted: leads.filter(lead =>
      lead.conversionDates.some(date => isInPeriod(date, period))
    ).length,
    cohortAssigned: cohort.filter(lead =>
      lead.assignmentDates.some(date => date < period.end)
    ).length,
    cohortTreated: cohort.filter(lead =>
      lead.contactDates.some(date => date < period.end)
    ).length,
    cohortCompleted: cohort.filter(lead =>
      lead.terminalDates.some(date => date < period.end)
    ).length,
    cohortConverted: cohort.filter(lead =>
      lead.conversionDates.some(date => date < period.end)
    ).length,
    firstContactAverageSeconds: average,
    withoutFirstContact: leads.filter(
      lead => lead.operational && lead.assigned && !lead.firstContactAt
    ).length,
    followUpsOverdue: followUps.filter(
      followUp => followUp.status === "pending" && followUp.dueAt < now
    ).length,
  };
}
