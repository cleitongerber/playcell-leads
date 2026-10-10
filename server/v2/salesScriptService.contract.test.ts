import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = read("server/v2/salesScriptService.ts");
const schema = read("drizzle-v2/schema.ts");
const migration = read("drizzle-v2/0016_v2_sales_scripts.sql");
const categoryMigration = read("drizzle-v2/0017_v2_sales_script_introduction_category.sql");
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
    for (const value of ["opening", "introduction", "discovery", "offer", "objections", "closing", "follow_up"]) {
      expect(service).toContain(`"${value}"`);
    }
    expect(router).toContain('z.enum(["all_campaigns", "specific_campaigns"])');
    expect(router).toContain('"introduction"');
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

  it("contains the approved twenty-three-script library in the intended category distribution and order", () => {
    const suggested = service.slice(service.indexOf("const suggestedScripts"), service.indexOf("function cleanText"));
    expect((suggested.match(/title: "/g) ?? []).length).toBe(23);
    expect((suggested.match(/category: "opening"/g) ?? []).length).toBe(2);
    expect((suggested.match(/category: "introduction"/g) ?? []).length).toBe(2);
    expect((suggested.match(/category: "discovery"/g) ?? []).length).toBe(5);
    expect((suggested.match(/category: "offer"/g) ?? []).length).toBe(3);
    expect((suggested.match(/category: "objections"/g) ?? []).length).toBe(5);
    expect((suggested.match(/category: "closing"/g) ?? []).length).toBe(3);
    expect((suggested.match(/category: "follow_up"/g) ?? []).length).toBe(3);
    expect(suggested.indexOf('title: "Primeiro contato"')).toBeLessThan(suggested.indexOf('title: "Apresentação direta"'));
    expect(suggested.indexOf('title: "Apresentação direta"')).toBeLessThan(suggested.indexOf('title: "Operadora atual"'));
    expect(suggested.indexOf('title: "Operadora atual"')).toBeLessThan(suggested.indexOf('title: "Conectar à necessidade"'));
    expect(suggested.indexOf('title: "Conectar à necessidade"')).toBeLessThan(suggested.indexOf('title: "Está caro"'));
    expect(suggested.indexOf('title: "Está caro"')).toBeLessThan(suggested.indexOf('title: "Avançar"'));
    expect(suggested.indexOf('title: "Avançar"')).toBeLessThan(suggested.indexOf('title: "Primeira retomada"'));
  });

  it("keeps bracketed fields literal and only materializes the library through the existing idempotent marker", () => {
    expect(service).toContain("[SEU NOME]");
    expect(service).toContain("[NECESSIDADE DO CLIENTE]");
    expect(service).toContain("[ASSUNTO]");
    expect(service).toContain('const SUGGESTED_LIBRARY_VERSION = "v2"');
    expect(service).toContain("if (existing) return { created: false, count: 0 }");
    expect(service).toContain("if (alreadySeeded) return { created: false, count: 0 }");
    expect(migration).not.toContain("INSERT INTO `sales_scripts`");
  });

  it("extends the persisted enum with an additive migration without touching the CODEX 027 migration", () => {
    expect(categoryMigration).toContain("ALTER TABLE `sales_scripts` MODIFY COLUMN `category`");
    expect(categoryMigration).toContain("'introduction'");
    expect(categoryMigration).not.toMatch(/INSERT|UPDATE|DELETE|DROP/i);
    expect(migration).not.toContain("introduction");
  });
});
