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
 * Official 016.4 analytics vocabulary. Flow facts use their append-only
 * entities; current lead status remains a separate snapshot and never creates
 * a commercial conversion by inference.
 */
export const analyticsMetricDefinitions = {
  leadsReceived:
    "Leads cuja receivedAt pertence ao período operacional selecionado.",
  leadsWorked:
    "Leads distintos com uma tentativa de contato ou tratativa efetiva ocorrida no período. Abrir WhatsApp, abrir ligação, visualizar ou anotar não conta como trabalho.",
  leadsWithAttempt:
    "Leads distintos com registro em lead_contact_attempts no período.",
  attempts:
    "Quantidade de registros append-only em lead_contact_attempts no período.",
  leadsWithEffectiveContact:
    "Leads distintos com lead_contacts.recordKind = effective_contact no período.",
  effectiveContacts:
    "Quantidade de lead_contacts com recordKind = effective_contact registrados no período.",
  interested:
    "Leads distintos com tratativa efetiva cujo snapshot resultCategory = interested no período.",
  conversions:
    "Eventos históricos em lead_conversions ocorridos no período. Uma mudança administrativa de situação não entra nesta métrica.",
  firstAttempt:
    "leads.firstAttemptAt; primeiro fato de tentativa no modelo oficial.",
  firstEffectiveContact:
    "leads.firstEffectiveContactAt; primeiro fato de interação efetiva no modelo oficial.",
  followUpOverdue:
    "Snapshot atual: follow_ups.status = pending e dueAt anterior a agora no fuso do parceiro. Overdue é derivado, não persistido.",
  effectiveContactRate:
    "Leads com contato efetivo no período divididos por Leads trabalhados no período.",
  conversionRate:
    "Leads convertidos no período divididos por Leads com contato efetivo no período.",
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

/** Resolves [start, end) in the partner timezone so periods do not overlap. */
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
    ) {
      throw new Error("O início do período deve ser anterior ao fim");
    }
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
    startParts = addCalendarDays(today, -((weekday + 6) % 7));
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

/** Deterministic unit-test mirror for the official SQL facts. */
export type AnalyticsMetricLead = {
  receivedAt: Date;
  operational: boolean;
  assigned: boolean;
  attemptDates: Date[];
  effectiveContactDates: Date[];
  interestedDates: Date[];
  conversionDates: Date[];
  firstAttemptAt?: Date | null;
  firstEffectiveContactAt?: Date | null;
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
  const received = leads.filter(lead => isInPeriod(lead.receivedAt, period));
  const hasAttempt = (lead: AnalyticsMetricLead) =>
    lead.attemptDates.some(date => isInPeriod(date, period));
  const hasEffective = (lead: AnalyticsMetricLead) =>
    lead.effectiveContactDates.some(date => isInPeriod(date, period));
  const worked = leads.filter(lead => hasAttempt(lead) || hasEffective(lead));
  const firstAttemptValues = leads
    .filter(
      lead => lead.firstAttemptAt && isInPeriod(lead.firstAttemptAt, period)
    )
    .map(
      lead =>
        (lead.firstAttemptAt!.getTime() - lead.receivedAt.getTime()) / 1_000
    );
  const firstEffectiveValues = leads
    .filter(
      lead =>
        lead.firstEffectiveContactAt &&
        isInPeriod(lead.firstEffectiveContactAt, period)
    )
    .map(
      lead =>
        (lead.firstEffectiveContactAt!.getTime() - lead.receivedAt.getTime()) /
        1_000
    );
  const average = (values: number[]) =>
    values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null;

  return {
    received: received.length,
    worked: worked.length,
    leadsWithAttempt: leads.filter(hasAttempt).length,
    attempts: leads.reduce(
      (total, lead) =>
        total +
        lead.attemptDates.filter(date => isInPeriod(date, period)).length,
      0
    ),
    leadsWithEffectiveContact: leads.filter(hasEffective).length,
    effectiveContacts: leads.reduce(
      (total, lead) =>
        total +
        lead.effectiveContactDates.filter(date => isInPeriod(date, period))
          .length,
      0
    ),
    interested: leads.filter(lead =>
      lead.interestedDates.some(date => isInPeriod(date, period))
    ).length,
    conversions: leads.filter(lead =>
      lead.conversionDates.some(date => isInPeriod(date, period))
    ).length,
    firstAttemptAverageSeconds: average(firstAttemptValues),
    firstEffectiveContactAverageSeconds: average(firstEffectiveValues),
    withoutWork: leads.filter(
      lead =>
        lead.operational &&
        lead.assigned &&
        !lead.firstAttemptAt &&
        !lead.firstEffectiveContactAt
    ).length,
    followUpsOverdue: followUps.filter(
      followUp => followUp.status === "pending" && followUp.dueAt < now
    ).length,
  };
}
