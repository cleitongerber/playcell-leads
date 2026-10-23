import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve(process.cwd(), "server/v2/leadService.ts"),
  "utf8"
);

describe("lead detail custom data contract", () => {
  it("loads custom field metadata only after the lead visibility checks", () => {
    const detailStart = service.indexOf("export async function getLeadDetail");
    const detail = service.slice(detailStart, service.indexOf("export async function assumeLead", detailStart));

    expect(detail.indexOf("await getLeadInPartner")).toBeLessThan(
      detail.indexOf("const customFields = await db")
    );
    expect(detail.indexOf("await assertLeadVisible")).toBeLessThan(
      detail.indexOf("const customFields = await db")
    );
    expect(detail).toContain("eq(customFieldDefinitions.partnerId, context.partnerId)");
    expect(detail).toContain('eq(customFieldDefinitions.entityType, "lead")');
    expect(detail).toContain("asc(customFieldDefinitions.sortOrder)");
    expect(detail).toContain("customFields,");
  });
});
