import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../../drizzle-v2/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartnerContext } from "./access";
import type {
  AnalyticsReportInput,
  AnalyticsReportType,
} from "./analyticsService";

const databaseMock = vi.hoisted(() => ({
  database: null as unknown,
  failure: null as Error | null,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  responses: [] as unknown[][],
}));

vi.mock("./database", async importOriginal => {
  const actual = await importOriginal<typeof import("./database")>();
  return {
    ...actual,
    getV2Db: vi.fn(async () => databaseMock.database),
  };
});

import { listAnalyticsReport } from "./analyticsService";

const reportTypes: AnalyticsReportType[] = [
  "leads",
  "attempts",
  "treatments",
  "conversions",
  "follow_ups",
  "imports",
  "distributions",
];

const context: PartnerContext = {
  partnerId: 41,
  membershipId: 17,
  role: "partner_admin",
  pdvScopeMode: "all",
  userId: 9,
};

const baseInput = {
  preset: "custom",
  fromDate: "2026-09-01",
  toDate: "2026-10-09",
  page: 1,
  pageSize: 25,
} as const;

function createDialectDatabase() {
  const client = {
    async query(
      query: { sql?: string },
      params: unknown[] = []
    ): Promise<[unknown[][], unknown[]]> {
      databaseMock.queries.push({ sql: query.sql ?? "", params });
      if (databaseMock.failure) throw databaseMock.failure;
      // This is a read-only dialect probe: every SQL builder runs through the
      // real mysql2 Drizzle session but receives an empty, controlled result.
      return [databaseMock.responses.shift() ?? [], []];
    },
  };
  return drizzle({
    client: client as never,
    schema,
    mode: "default",
  });
}

describe("V2 analytics report MySQL/TiDB query execution contract", () => {
  beforeEach(() => {
    databaseMock.queries.length = 0;
    databaseMock.failure = null;
    databaseMock.responses.length = 0;
    databaseMock.database = createDialectDatabase();
  });

  for (const type of reportTypes) {
    it(`builds and executes the scoped ${type} report SQL without a derived-field alias error`, async () => {
      const report = await listAnalyticsReport(context, {
        ...baseInput,
        type,
      } as AnalyticsReportInput);

      expect(report.type).toBe(type);
      expect(report.rows).toEqual([]);
      expect(report.total).toBe(0);
      expect(databaseMock.queries.length).toBeGreaterThan(0);
      expect(
        databaseMock.queries.some(query => query.sql.includes("partnerId"))
      ).toBe(true);
      expect(databaseMock.queries.flatMap(query => query.params)).toContain(
        context.partnerId
      );
      expect(
        databaseMock.queries
          .flatMap(query => query.params)
          .some(value => (Array.isArray(value) ? value.length === 0 : false))
      ).toBe(false);
    });
  }

  it("keeps the lead report aggregate facts addressable as derived columns", async () => {
    await listAnalyticsReport(context, {
      ...baseInput,
      type: "leads",
    });

    const leadQuery = databaseMock.queries.find(query =>
      query.sql.includes("report_lead_treatment_stats")
    );
    expect(leadQuery?.sql).toContain("as `evidenceCount`");
    expect(leadQuery?.sql).toContain("as `eligibleTreatments`");
    expect(leadQuery?.sql).toContain("as `treatmentsWithEvidence`");
    expect(leadQuery?.sql).toContain("as `requiredEvidencePending`");
  });

  it("keeps the tenant and specific-PDV predicates in a compiled lead report", async () => {
    // resolvePdvScope is the first query for a scoped manager. The remaining
    // queries intentionally receive empty read-only results.
    databaseMock.responses.push([[901]]);
    const manager: PartnerContext = {
      partnerId: context.partnerId,
      membershipId: 18,
      role: "manager",
      pdvScopeMode: "specific",
      userId: 10,
    };

    await listAnalyticsReport(manager, { ...baseInput, type: "leads" });

    const leadQuery = databaseMock.queries.find(query =>
      query.sql.includes("report_lead_treatment_stats")
    );
    expect(leadQuery?.sql).toMatch(/`leads`\.`partnerId` = \?/);
    expect(leadQuery?.sql).toMatch(/`leads`\.`pdvId` in \(\?\)/);
    expect(leadQuery?.params).toContain(context.partnerId);
    expect(leadQuery?.params).toContain(901);
    expect(leadQuery?.sql).not.toContain("in ()");
  });

  it("logs a safe operational context and rethrows a query failure", async () => {
    const failure = Object.assign(new Error("database query failed"), {
      code: "ER_TEST_QUERY",
      errno: 1105,
      sqlState: "HY000",
    });
    databaseMock.failure = failure;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      listAnalyticsReport(context, { ...baseInput, type: "leads" })
    ).rejects.toThrow("Failed query");

    expect(errorLog).toHaveBeenCalledWith(
      "[analytics.reports] list failed",
      expect.objectContaining({
        reportType: "leads",
        partnerId: context.partnerId,
        role: context.role,
        pdvScopeMode: context.pdvScopeMode,
        errorName: "Error",
        errorCauseName: "Error",
        errorCode: "ER_TEST_QUERY",
        errorErrno: 1105,
        errorSqlState: "HY000",
        errorMessage: "database query failed",
      })
    );
    errorLog.mockRestore();
  });
});
