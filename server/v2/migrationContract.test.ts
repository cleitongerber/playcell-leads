import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import {
  leadDistributionBatches,
  leadContacts,
  leadTimelineEvents,
  leads,
  followUps,
} from "../../drizzle-v2/schema";

describe("V2 migration tenant-key contract", () => {
  it("defines the composite lead key required by TiDB before adding child FKs", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle-v2/0003_v2_leads_timeline.sql"),
      "utf8"
    );
    const leadKey =
      "CONSTRAINT `leads_id_partner_unique` UNIQUE(`id`,`partnerId`)";
    const childForeignKey =
      "ALTER TABLE `lead_contacts` ADD CONSTRAINT `lead_contacts_lead_tenant_fk`";

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

  it("adds the distribution batch and tenant-scoped performance indexes incrementally", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle-v2/0008_v2_lead_distribution.sql"),
      "utf8"
    );
    expect(migration).toContain("CREATE TABLE `lead_distribution_batches`");
    expect(migration).toContain(
      "lead_distribution_batches_partner_actor_request_unique"
    );
    expect(migration).toContain("leads_partner_distribution_filter_idx");
    expect(migration).toContain("lead_reassigned");
    expect(migration).toContain("follow_up_owner_changed");

    const leadIndexes = getTableConfig(leads).indexes.map(
      index => index.config.name
    );
    expect(leadIndexes).toContain("leads_partner_distribution_filter_idx");
    expect(leadIndexes).toContain("leads_partner_campaign_activity_idx");
    expect(
      getTableConfig(leadDistributionBatches).indexes.some(
        index =>
          index.config.name ===
          "lead_distribution_batches_partner_actor_request_unique"
      )
    ).toBe(true);
    const timelineType = getTableConfig(leadTimelineEvents).columns.find(
      column => column.name === "type"
    );
    expect(timelineType?.enumValues).toContain("lead_returned_to_queue");
  });

  it("adds only the analytics indexes needed by period, actor and event queries", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle-v2/0009_v2_analytics_indexes.sql"),
      "utf8"
    );
    expect(migration).toContain("leads_partner_analytics_received_idx");
    expect(migration).toContain("lead_contacts_partner_actor_occurred_idx");
    expect(migration).toContain(
      "lead_timeline_events_partner_type_occurred_idx"
    );
    expect(migration).toContain("follow_ups_partner_owner_completed_idx");

    expect(
      getTableConfig(leads).indexes.map(index => index.config.name)
    ).toContain("leads_partner_analytics_received_idx");
    expect(
      getTableConfig(leadContacts).indexes.map(index => index.config.name)
    ).toContain("lead_contacts_partner_actor_occurred_idx");
    expect(
      getTableConfig(leadTimelineEvents).indexes.map(index => index.config.name)
    ).toContain("lead_timeline_events_partner_type_occurred_idx");
    expect(
      getTableConfig(followUps).indexes.map(index => index.config.name)
    ).toContain("follow_ups_partner_owner_completed_idx");
  });
});
