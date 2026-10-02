import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/v2/governanceService.ts"),
  "utf8"
);

describe("governance configuration contract", () => {
  it("validates restricted treatment outcomes against the active partner catalogue before writes", () => {
    expect(source).toContain("listPartnerInteractionResults(");
    expect(source).toContain('"effective_contact"');
    expect(source).toContain("assertAllowedOutcomeCodes(");
    expect(source).toContain("await assertGovernanceRuleConfiguration(");
  });

  it("uses the same channel guard for partner and campaign attempt settings", () => {
    expect(
      source.match(/assertSupportedGovernanceChannels\(rule\)/g)
    ).toHaveLength(3);
  });
});
