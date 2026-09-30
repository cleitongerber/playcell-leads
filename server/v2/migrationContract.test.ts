import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import {
  leadDistributionBatches,
  leadContactAttempts,
  leadContacts,
  leadConversions,
  leadInteractionResults,
  leadOperationCommands,
  leadTimelineEvents,
  leads,
  campaignGovernanceOverrides,
  followUps,
  partnerGovernanceRules,
  partnerSettings,
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

  it("adds direct-contact configuration incrementally without creating a second evidence model", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle-v2/0010_v2_direct_contact_templates.sql"),
      "utf8"
    );
    expect(migration).toContain("whatsappInitialMessageTemplate");
    expect(migration).toContain("evidenceRequiredChannels");
    expect(migration).not.toContain("CREATE TABLE `lead_contact");

    expect(
      getTableConfig(partnerSettings).columns.some(
        column => column.name === "whatsappInitialMessageTemplate"
      )
    ).toBe(true);
    expect(
      getTableConfig(partnerGovernanceRules).columns.some(
        column => column.name === "evidenceRequiredChannels"
      )
    ).toBe(true);
    expect(
      getTableConfig(campaignGovernanceOverrides).columns.some(
        column => column.name === "evidenceRequiredChannels"
      )
    ).toBe(true);
  });

  it("adds the 016.1 journey foundation without reinterpreting legacy operations", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle-v2/0011_v2_lead_journey_foundation.sql"),
      "utf8"
    );

    expect(migration).toContain("CREATE TABLE `lead_contact_attempts`");
    expect(migration).toContain("CREATE TABLE `lead_interaction_results`");
    expect(migration).toContain("CREATE TABLE `lead_conversions`");
    expect(migration).toContain("CREATE TABLE `lead_operation_commands`");
    expect(migration).toContain(
      "`leadJourneyMode` enum('legacy','separated_contact_v1') DEFAULT 'legacy' NOT NULL"
    );
    expect(migration).toContain(
      "`recordKind` enum('legacy','effective_contact') DEFAULT 'legacy' NOT NULL"
    );
    expect(migration).toContain(
      "`operationKind` enum('legacy_contact','attempt','effective_contact') DEFAULT 'legacy_contact' NOT NULL"
    );
    expect(migration).toContain(
      "`attemptMode` enum('inherit','override') DEFAULT 'inherit' NOT NULL"
    );
    expect(migration).toContain(
      "lead_contact_attempts_timeline_lead_tenant_fk"
    );
    expect(migration).toContain("lead_contact_attempts_result_tenant_fk");
    expect(migration).toContain("lead_conversions_effective_contact_tenant_fk");
    expect(migration).toContain("lead_conversions_result_tenant_fk");
    expect(migration).toContain("lead_interaction_results_status_tenant_fk");
    expect(migration).toContain(
      "lead_operation_commands_partner_actor_operation_request_unique"
    );
    expect(migration).toContain("message_sent");
    expect(migration).toContain("sale_completed");
    expect(migration).not.toContain("INSERT INTO `lead_contacts`");
    expect(migration).not.toContain("INSERT INTO `lead_conversions`");
    expect(migration).not.toContain("INSERT INTO `lead_contact_attempts`");
    expect(migration).not.toContain("UPDATE `leads` SET `firstAttemptAt`");
    expect(migration).not.toContain(
      "UPDATE `leads` SET `firstEffectiveContactAt`"
    );

    const attemptColumns = getTableConfig(leadContactAttempts).columns.map(
      column => column.name
    );
    expect(attemptColumns).toEqual(
      expect.arrayContaining([
        "partnerId",
        "leadId",
        "timelineEventId",
        "resultId",
        "resultCode",
        "resultLabel",
        "resultCategory",
      ])
    );
    expect(
      getTableConfig(leadContactAttempts).indexes.map(
        index => index.config.name
      )
    ).toEqual(
      expect.arrayContaining([
        "lead_contact_attempts_partner_lead_occurred_idx",
        "lead_contact_attempts_partner_actor_occurred_idx",
        "lead_contact_attempts_partner_result_occurred_idx",
      ])
    );
    expect(
      getTableConfig(leadInteractionResults).indexes.some(
        index =>
          index.config.name ===
            "lead_interaction_results_partner_kind_code_unique" &&
          index.config.unique
      )
    ).toBe(true);
    expect(
      getTableConfig(leadConversions).indexes.some(
        index =>
          index.config.name ===
            "lead_conversions_partner_effective_contact_unique" &&
          index.config.unique
      )
    ).toBe(true);
    expect(
      getTableConfig(leadOperationCommands).indexes.some(
        index =>
          index.config.name ===
            "lead_operation_commands_partner_actor_operation_request_unique" &&
          index.config.unique
      )
    ).toBe(true);
    expect(
      getTableConfig(leadContacts).columns.find(
        column => column.name === "recordKind"
      )?.enumValues
    ).toEqual(["legacy", "effective_contact"]);
    expect(
      getTableConfig(leadTimelineEvents).columns.find(
        column => column.name === "type"
      )?.enumValues
    ).toEqual(
      expect.arrayContaining([
        "contact_attempted",
        "effective_contact_recorded",
        "conversion_recorded",
        "lead_reopened",
        "administrative_status_changed",
      ])
    );
  });

  it("uses the official V2 migrator as the Render Free build gate", () => {
    const renderBlueprint = readFileSync(
      resolve(process.cwd(), "render.yaml"),
      "utf8"
    );

    expect(renderBlueprint).toContain("pnpm db:migrate");
    expect(renderBlueprint).not.toContain("db:push");
  });

  it("enables the separated journey only for existing pre-operational partners", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "drizzle-v2/0012_v2_enable_separated_lead_journey.sql"
      ),
      "utf8"
    );

    expect(migration).toContain("UPDATE `partner_settings`");
    expect(migration).toContain("'separated_contact_v1'");
    expect(migration).not.toContain("INSERT INTO `partners`");
    expect(migration).not.toContain("DELETE FROM");
  });

  it("makes the unified journey the default without dropping historical compatibility", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle-v2/0013_v2_unified_lead_journey.sql"),
      "utf8"
    );

    expect(migration).toContain("MODIFY COLUMN `leadJourneyMode`");
    expect(migration).toContain("DEFAULT 'separated_contact_v1'");
    expect(migration).not.toContain("UPDATE `leads`");
    expect(migration).not.toContain("DELETE FROM");
    expect(migration).not.toContain("DROP ");
    expect(
      getTableConfig(partnerSettings).columns.find(
        column => column.name === "leadJourneyMode"
      )?.default
    ).toBe("separated_contact_v1");
  });
});
