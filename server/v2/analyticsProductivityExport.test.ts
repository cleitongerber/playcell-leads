import { describe, expect, it } from "vitest";
import {
  assertProductivityExportLimit,
  buildProductivityExportRows,
  formatProductivityCsv,
  PRODUCTIVITY_EXPORT_ROW_MAX,
  type ProductivityAnalytics,
} from "./analyticsService";

const analytics: ProductivityAnalytics = {
  period: {
    start: new Date("2026-11-01T03:00:00.000Z"),
    end: new Date("2026-12-01T03:00:00.000Z"),
    timeZone: "America/Sao_Paulo",
    label: "Novembro",
  },
  totals: {
    sellers: 1,
    portfolio: 5,
    attempts: 3,
    leadsWithAttempt: 2,
    attemptsPerLead: 1.5,
    effectiveContacts: 1,
    leadsWithEffectiveContact: 1,
    worked: 2,
    workCoverage: 0.4,
    effectiveContactRate: 0.5,
    conversions: 1,
    leadsConverted: 1,
    conversionRate: 1,
    firstAttemptAverageSeconds: 300,
    firstEffectiveContactAverageSeconds: 600,
    followUpsOverdue: 1,
    followUpsCompleted: 2,
  },
  sellers: [
    {
      membershipId: 7,
      name: "=Vendedor de teste",
      pdvIds: [3],
      pdvNames: ["PDV Centro"],
      leadsInPortfolio: 5,
      leadsAssignedInPeriod: 2,
      leadsWorked: 2,
      attempts: 3,
      leadsWithAttempt: 2,
      effectiveContacts: 1,
      leadsWithEffectiveContact: 1,
      interested: 1,
      conversions: 1,
      leadsConverted: 1,
      followUpsCreated: 2,
      followUpsCompleted: 1,
      followUpsOverdue: 1,
      followUpsPending: 1,
      followUpsFromAttempts: 1,
      followUpsFromTreatments: 1,
      followUpsIndependent: 0,
      firstAttemptAverageSeconds: 300,
      firstEffectiveContactAverageSeconds: 600,
      leadsWithoutWork: 3,
      governanceComplete: 2,
      governancePending: 1,
      lastActivityAt: new Date("2026-11-03T15:00:00.000Z"),
      effectiveContactRate: 0.5,
      conversionRate: 1,
      workCoverage: 0.4,
      attemptsPerLead: 1.5,
      followUpCompletionRate: 0.5,
    },
  ],
  daily: [],
};

const metadata = {
  partner: "Parceiro de teste",
  campaign: "Todas as campanhas autorizadas",
  pdv: "PDV Centro",
  seller: "Todos os vendedores autorizados",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  timeZone: "America/Sao_Paulo",
  generatedAt: "07/11/2026, 10:30:00",
};

describe("V2 productivity export", () => {
  it("uses the official productivity facts without recalculating rates", () => {
    const [row] = buildProductivityExportRows(analytics, metadata);

    expect(row).toMatchObject({
      partner: "Parceiro de teste",
      filterPdv: "PDV Centro",
      seller: "=Vendedor de teste",
      portfolio: 5,
      assignedInPeriod: 2,
      withoutWork: 3,
      workCoverage: 40,
      attemptsPerLead: 1.5,
      effectiveContactRate: 50,
      conversionRate: 100,
      firstAttemptAverageSeconds: 300,
      followUpsOverdue: 1,
      governancePending: 1,
    });
  });

  it("keeps the CSV tabular, UTF-8 compatible, and safe from spreadsheet formulas", () => {
    const csv = formatProductivityCsv(analytics, metadata);

    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"Carteira atual (snapshot)"');
    expect(csv).toContain('"Tentativas (período)"');
    expect(csv).toContain('"\'=Vendedor de teste"');
  });

  it("preserves null metrics when no valid denominator exists", () => {
    const emptyRates: ProductivityAnalytics = {
      ...analytics,
      sellers: [
        {
          ...analytics.sellers[0],
          workCoverage: null,
          effectiveContactRate: null,
          conversionRate: null,
          attemptsPerLead: null,
        },
      ],
    };

    const [row] = buildProductivityExportRows(emptyRates, metadata);
    expect(row.workCoverage).toBeNull();
    expect(row.effectiveContactRate).toBeNull();
    expect(row.conversionRate).toBeNull();
    expect(row.attemptsPerLead).toBeNull();
  });

  it("rejects exports above the explicit seller limit without truncating", () => {
    expect(() => assertProductivityExportLimit(PRODUCTIVITY_EXPORT_ROW_MAX)).not.toThrow();
    expect(() =>
      assertProductivityExportLimit(PRODUCTIVITY_EXPORT_ROW_MAX + 1)
    ).toThrow("Refine os filtros antes de exportar");
  });
});
