import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = read("server/v2/salesScriptService.ts");
const schema = read("drizzle-v2/schema.ts");
const migration = read("drizzle-v2/0016_v2_sales_scripts.sql");
const router = read("server/v2/router.ts");

describe("sales scripts contract", () => {
  it("persists a tenant-scoped, campaign-safe library", () => {
    expect(schema).toContain('"sales_scripts"');
    expect(schema).toContain('"sales_script_campaigns"');
    expect(schema).toContain('"partner_sales_script_libraries"');
    expect(migration).toContain("FOREIGN KEY (`salesScriptId`,`partnerId`)");
    expect(migration).toContain("FOREIGN KEY (`campaignId`,`partnerId`)");
    expect(migration).toContain("UNIQUE(`salesScriptId`,`campaignId`)");
  });

  it("uses closed category and scope values and validates campaign scope", () => {
    for (const value of ["opening", "discovery", "offer", "objections", "closing", "follow_up"]) {
      expect(service).toContain(`"${value}"`);
    }
    expect(router).toContain('z.enum(["all_campaigns", "specific_campaigns"])');
    expect(service).toContain("Selecione ao menos uma campanha para este script");
    expect(service).toContain("Uma ou mais campanhas não pertencem ao parceiro atual");
  });

  it("makes Lead reading authoritative through an authorized lead, never a client campaign", () => {
    const block = service.slice(service.indexOf("export async function listSalesScriptsForLead"), service.indexOf("export async function materializeSuggested"));
    expect(block).toContain("leadId: number");
    expect(block).toContain("resolvePdvScope");
    expect(block).toContain("eq(leads.partnerId, context.partnerId)");
    expect(block).toContain("lead.assignedMembershipId !== context.membershipId");
    expect(block).toContain("eq(salesScriptCampaigns.campaignId, lead.campaignId)");
    expect(block).toContain("lead.campaignId");
  });

  it("keeps administration and suggested materialization restricted to PartnerContext admins", () => {
    expect(router).toContain("salesScripts: v2Router");
    expect(router).toContain("v2PartnerAdminProcedure");
    expect(router).toContain("materializeSuggested");
    expect(service).toContain("suggestedLibraryAdded");
    expect(service).toContain("contentLength");
    expect(service).toContain("writeV2Audit");
  });

  it("contains the explicit fifteen-script suggested library and no implicit migration seed", () => {
    expect((service.match(/title: "/g) ?? []).length).toBe(15);
    expect(migration).not.toContain("INSERT INTO `sales_scripts`");
  });
});
