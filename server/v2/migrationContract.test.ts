import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { leads } from "../../drizzle-v2/schema";

describe("V2 migration tenant-key contract", () => {
  it("defines the composite lead key required by TiDB before adding child FKs", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle-v2/0003_v2_leads_timeline.sql"),
      "utf8"
    );
    const leadKey = "CONSTRAINT `leads_id_partner_unique` UNIQUE(`id`,`partnerId`)";
    const childForeignKey = "ALTER TABLE `lead_contacts` ADD CONSTRAINT `lead_contacts_lead_tenant_fk`";

    expect(migration).toContain(leadKey);
    expect(migration.indexOf(leadKey)).toBeLessThan(
      migration.indexOf(childForeignKey)
    );
  });

  it("keeps the declared Drizzle schema aligned with the TiDB tenant key", () => {
    const tenantIndex = getTableConfig(leads).indexes.find(
      index => index.config.name === "leads_id_partner_unique"
    );

    expect(tenantIndex?.config.unique).toBe(true);
    expect(tenantIndex?.config.columns.map(column => column.name)).toEqual([
      "id",
      "partnerId",
    ]);
  });
});
