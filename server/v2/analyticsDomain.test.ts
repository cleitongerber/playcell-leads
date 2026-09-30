import { describe, expect, it } from "vitest";
import {
  analyticsMetricDefinitions,
  calculateAnalyticsMetricSamples,
  durationLabel,
  percentageChange,
  resolveAnalyticsPeriod,
  safeRate,
} from "./analyticsDomain";

describe("V2 analytics domain", () => {
  const zone = "America/Sao_Paulo";

  it("defines metrics from operational entities rather than simulated status", () => {
    expect(analyticsMetricDefinitions.leadsWorked).toContain("tentativa");
    expect(analyticsMetricDefinitions.attempts).toContain(
      "lead_contact_attempts"
    );
    expect(analyticsMetricDefinitions.effectiveContacts).toContain(
      "effective_contact"
    );
    expect(analyticsMetricDefinitions.followUpOverdue).toContain("pending");
    expect(analyticsMetricDefinitions.conversions).toContain(
      "lead_conversions"
    );
  });

  it("resolves a partner-local day around UTC midnight", () => {
    const period = resolveAnalyticsPeriod(
      zone,
      { preset: "today" },
      new Date("2026-09-25T01:30:00.000Z")
    );

    // 01:30 UTC is still 24/09 in São Paulo.
    expect(period.start.toISOString()).toBe("2026-09-24T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-09-25T03:00:00.000Z");
  });

  it("uses an exclusive end and an equivalent previous comparison range", () => {
    const period = resolveAnalyticsPeriod(zone, {
      preset: "custom",
      fromDate: "2026-09-01",
      toDate: "2026-09-15",
    });

    expect(period.end.getTime() - period.start.getTime()).toBe(
      period.previousEnd.getTime() - period.previousStart.getTime()
    );
    expect(period.previousEnd).toEqual(period.start);
  });

  it("never invents a rate or contact duration with an empty denominator", () => {
    expect(safeRate(3, 0)).toBeNull();
    expect(percentageChange(3, 0)).toBeNull();
    expect(durationLabel(null)).toBe("—");
    expect(durationLabel(3_660)).toBe("1h 1min");
  });

  it("calculates attempts, effective contacts, conversions and overdue follow-ups from real facts", () => {
    const period = resolveAnalyticsPeriod(zone, {
      preset: "custom",
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });
    const at = (value: string) => new Date(`${value}T12:00:00.000Z`);
    const metrics = calculateAnalyticsMetricSamples(
      [
        {
          receivedAt: at("2026-09-02"),
          operational: true,
          assigned: true,
          attemptDates: [at("2026-09-02")],
          effectiveContactDates: [at("2026-09-03")],
          interestedDates: [at("2026-09-03")],
          conversionDates: [at("2026-09-03")],
          firstAttemptAt: new Date("2026-09-02T12:10:00.000Z"),
          firstEffectiveContactAt: new Date("2026-09-03T12:10:00.000Z"),
        },
        {
          receivedAt: at("2026-09-03"),
          operational: true,
          assigned: false,
          attemptDates: [],
          effectiveContactDates: [],
          interestedDates: [],
          conversionDates: [],
        },
        {
          receivedAt: at("2026-08-28"),
          operational: true,
          assigned: true,
          attemptDates: [at("2026-09-04")],
          effectiveContactDates: [at("2026-09-05")],
          interestedDates: [],
          conversionDates: [],
          firstAttemptAt: at("2026-09-04"),
          firstEffectiveContactAt: at("2026-09-05"),
        },
        {
          receivedAt: at("2026-08-20"),
          operational: true,
          assigned: true,
          attemptDates: [],
          effectiveContactDates: [],
          interestedDates: [],
          conversionDates: [],
        },
      ],
      [
        { status: "pending", dueAt: at("2026-08-31") },
        { status: "pending", dueAt: at("2026-10-02") },
        { status: "completed", dueAt: at("2026-08-31") },
      ],
      period,
      at("2026-09-10")
    );

    expect(metrics).toMatchObject({
      received: 2,
      worked: 2,
      leadsWithAttempt: 2,
      attempts: 2,
      leadsWithEffectiveContact: 2,
      effectiveContacts: 2,
      interested: 1,
      conversions: 1,
      withoutWork: 1,
      followUpsOverdue: 1,
    });
    expect(metrics.firstAttemptAverageSeconds).toBe(302_700);
    expect(metrics.firstEffectiveContactAverageSeconds).toBe(389_100);
  });
});
