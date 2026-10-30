import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(resolve(process.cwd(), "server/v2/leadService.ts"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/v2/router.ts"), "utf8");

describe("lead campaign availability filter contract", () => {
  it("filters campaign availability before count and pagination", () => {
    const list = service.slice(service.indexOf("export async function listLeads"), service.indexOf("export async function getLeadDetail"));
    expect(list).toContain('const campaignStatus = input.campaignStatus ?? "all"');
    expect(list).toContain('eq(campaigns.status, "active")');
    expect(list).toContain("eq(campaigns.isFrozen, false)");
    expect(list).toContain('eq(campaigns.status, "closed")');
    expect(list).toContain('eq(campaigns.status, "archived")');
    expect(list).toContain("innerJoin(campaigns, eq(campaigns.id, leads.campaignId))");
    expect(list).toContain("campaignFrozen: campaigns.isFrozen");
  });

  it("accepts the filter only through the typed leads.list API", () => {
    const list = router.slice(router.indexOf("list: v2PartnerProcedure"), router.indexOf("managementFilters", router.indexOf("list: v2PartnerProcedure")));
    expect(list).toContain("campaignStatus: z");
    expect(list).toContain('"frozen"');
    expect(list).toContain('"archived"');
  });
});
