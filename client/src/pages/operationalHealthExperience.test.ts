import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("operational health experience contract", () => {
  const dashboard = read("client/src/pages/V2Dashboard.tsx");
  const reports = read("client/src/pages/V2Reports.tsx");
  const analytics = read("server/v2/analyticsService.ts");

  it("uses one backend drill-down source for every health and evidence metric", () => {
    expect(dashboard).toContain("analytics.healthDetails.useQuery");
    expect(dashboard).toContain("evidence_required_pending");
    expect(dashboard).toContain("attempt_evidence_required_pending");
    expect(dashboard).toContain("currentV2Path()");
    expect(analytics).toContain("listAnalyticsHealthDetails");
    expect(analytics).toContain("queryEvidenceCoverage");
    expect(analytics).toContain('recordKind, "effective_contact"');
    expect(analytics).toContain("leadContactAttempts");
    expect(analytics).toContain("attemptCoverage");
  });

  it("keeps reports and CSV inputs aligned for evidence and follow-up filters", () => {
    expect(reports).toContain("evidenceFilter");
    expect(reports).toContain("followUpSituation");
    expect(reports).toContain("followUpDateField");
    expect(reports).toContain("Exportar CSV");
    expect(analytics).toContain("documentaryStatus");
    expect(analytics).toContain("lastInteractionAt");
    expect(analytics).toContain("createAvailableEvidenceByEvent");
    expect(analytics).toContain("report_attempt_available_evidence");
  });
});
