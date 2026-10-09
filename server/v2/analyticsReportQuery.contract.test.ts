import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const service = read("server/v2/analyticsService.ts");
const reportsPage = read("client/src/pages/V2Reports.tsx");
const reportQueryBlock = service.slice(
  service.indexOf("function createLeadReportFacts"),
  service.indexOf("/** SQL-paginated report registry")
);

describe("V2 analytics report query contract", () => {
  it("uses tenant-scoped derived facts instead of correlated report lookups", () => {
    expect(reportQueryBlock).toContain("createLeadReportFacts");
    expect(reportQueryBlock).toContain("createAvailableEvidenceByEvent");
    expect(reportQueryBlock).toContain("createFollowUpsByOriginEvent");
    expect(reportQueryBlock).toContain(
      "createLastOperationalInteractionByLead"
    );
    expect(reportQueryBlock).toContain("createReopenedConversionFacts");
    expect(reportQueryBlock).toContain(
      "eq(leadEvidences.partnerId, context.partnerId)"
    );
    expect(reportQueryBlock).toContain(
      "eq(leadContactAttempts.partnerId, context.partnerId)"
    );
    expect(reportQueryBlock).toContain(
      "eq(leadContacts.partnerId, context.partnerId)"
    );
    expect(reportQueryBlock).toContain(
      "eq(leadConversions.partnerId, context.partnerId)"
    );
    expect(reportQueryBlock).not.toMatch(/\(\s*select\b/i);
    expect(reportQueryBlock).not.toMatch(/\bexists\s*\(\s*select\b/i);
  });

  it("keeps every implemented report type routed through the same scoped service", () => {
    for (const type of [
      'input.type === "leads"',
      'input.type === "attempts"',
      'input.type === "treatments"',
      'input.type === "conversions"',
      'input.type === "follow_ups"',
      'input.type === "imports"',
      'input.type === "distributions"',
    ]) {
      expect(service).toContain(type);
    }
    expect(service).toContain("const report = await listAnalyticsReport(");
    expect(service).toContain(
      "{ ...input, page: 1, pageSize: EXPORT_ROW_MAX }"
    );
  });

  it("keeps a transport error distinct from a legitimate empty result", () => {
    expect(reportsPage).toContain("report.isError ?");
    expect(reportsPage).toContain(
      "Ocorreu um erro ao carregar o relatório. Tente novamente."
    );
    expect(reportsPage).toContain("Nenhum registro para os filtros aplicados.");
    expect(reportsPage.indexOf("report.isError ?")).toBeLessThan(
      reportsPage.indexOf("Nenhum registro para os filtros aplicados.")
    );
  });
});
