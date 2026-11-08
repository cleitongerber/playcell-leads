import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../../drizzle-v2/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PartnerContext } from "./access";

const databaseMock = vi.hoisted(() => ({
  database: null as unknown,
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

import { exportProductivityAnalytics } from "./analyticsService";

const context: PartnerContext = {
  partnerId: 41,
  membershipId: 17,
  role: "partner_admin",
  pdvScopeMode: "all",
  userId: 9,
};

function createDialectDatabase() {
  const client = {
    async query(
      query: { sql?: string },
      params: unknown[] = []
    ): Promise<[unknown[][], unknown[]]> {
      databaseMock.queries.push({ sql: query.sql ?? "", params });
      return [databaseMock.responses.shift() ?? [], []];
    },
  };
  return drizzle({
    client: client as never,
    schema,
    mode: "default",
  });
}

describe("V2 productivity export execution contract", () => {
  beforeEach(() => {
    databaseMock.queries.length = 0;
    databaseMock.responses.length = 0;
    databaseMock.database = createDialectDatabase();
  });

  function queueAuthorizedAnalytics() {
    databaseMock.responses.push(
      [{ timezone: "America/Sao_Paulo", stale: 1440 }],
      [
        {
          membershipId: 17,
          name: "Vendedor autorizado",
          pdvId: 901,
          pdvName: "PDV autorizado",
        },
      ],
      ...Array.from({ length: 16 }, () => []),
      [{ name: "Parceiro autorizado" }],
      []
    );
  }

  it("exports the complete authorized seller result and records a sanitized audit event", async () => {
    databaseMock.responses.push(
      [{ timezone: "America/Sao_Paulo", stale: 1440 }],
      [
        {
          membershipId: 17,
          name: "Vendedor autorizado",
          pdvId: 901,
          pdvName: "PDV autorizado",
        },
      ],
      ...Array.from({ length: 16 }, () => []),
      [{ name: "Parceiro autorizado" }],
      []
    );

    const result = await exportProductivityAnalytics(context, {
      preset: "custom",
      fromDate: "2026-11-01",
      toDate: "2026-11-07",
    });

    expect(result.total).toBe(1);
    expect(result.fileName).toBe("fluxo-produtividade-2026-11-01-2026-11-07.csv");
    expect(result.content).toContain('"Carteira atual (snapshot)"');
    expect(result.content).toContain('"Tentativas (período)"');

    const auditQuery = databaseMock.queries.find(query =>
      query.sql.includes("audit_logs")
    );
    expect(auditQuery?.params).toContain("analytics_productivity_exported");
    expect(auditQuery?.params).toContain(context.partnerId);
    expect(auditQuery?.params).toContain(context.userId);
    expect(JSON.stringify(auditQuery?.params)).not.toContain("Vendedor autorizado");
  });

  it("exports XLSX through the same authorized calculation and audits the selected format", async () => {
    queueAuthorizedAnalytics();

    const result = await exportProductivityAnalytics(
      context,
      { preset: "custom", fromDate: "2026-11-01", toDate: "2026-11-07" },
      "xlsx"
    );

    expect(result.fileName).toBe("fluxo-produtividade-2026-11-01-2026-11-07.xlsx");
    expect(result.encoding).toBe("base64");
    expect(result.mimeType).toContain("spreadsheetml.sheet");
    expect(result.content.length).toBeGreaterThan(100);
    const auditQuery = databaseMock.queries.find(query =>
      query.sql.includes("audit_logs")
    );
    expect(
      auditQuery?.params.some(param => String(param).includes('"format":"xlsx"'))
    ).toBe(true);
  });

  it("does not record a successful audit event when XLSX generation fails", async () => {
    queueAuthorizedAnalytics();

    await expect(
      exportProductivityAnalytics(
        context,
        { preset: "custom", fromDate: "2026-11-01", toDate: "2026-11-07" },
        "xlsx",
        { generateXlsx: async () => Promise.reject(new Error("XLSX unavailable")) }
      )
    ).rejects.toThrow("XLSX unavailable");
    expect(
      databaseMock.queries.some(query => query.sql.includes("audit_logs"))
    ).toBe(false);
  });

  it("propagates an audit persistence failure after generation instead of reporting export success", async () => {
    queueAuthorizedAnalytics();
    let generated = false;

    await expect(
      exportProductivityAnalytics(
        context,
        { preset: "custom", fromDate: "2026-11-01", toDate: "2026-11-07" },
        "xlsx",
        {
          generateXlsx: async () => {
            generated = true;
            return "xlsx-content";
          },
          writeAudit: async () => Promise.reject(new Error("Audit unavailable")),
        }
      )
    ).rejects.toThrow("Audit unavailable");
    expect(generated).toBe(true);
  });

  it("rejects a manipulated PDV before producing a file or audit event", async () => {
    databaseMock.responses.push([]);

    await expect(
      exportProductivityAnalytics(context, { pdvId: 901 })
    ).rejects.toThrow("PDV indisponível no seu escopo");

    expect(
      databaseMock.queries.some(query => query.sql.includes("audit_logs"))
    ).toBe(false);
  });

  it("keeps a seller export constrained to its own membership", async () => {
    const sellerContext: PartnerContext = {
      ...context,
      role: "seller",
      pdvScopeMode: "specific",
    };
    databaseMock.responses.push([{ pdvId: 901 }]);

    await expect(
      exportProductivityAnalytics(sellerContext, { sellerMembershipId: 18 })
    ).rejects.toThrow("Vendedor indisponível no seu escopo");

    expect(
      databaseMock.queries.some(query => query.sql.includes("audit_logs"))
    ).toBe(false);
  });
});
