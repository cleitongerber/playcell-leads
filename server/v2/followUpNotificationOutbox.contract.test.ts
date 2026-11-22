import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { followUpNotificationDeliveries, followUps } from "../../drizzle-v2/schema";

const service = readFileSync(resolve(process.cwd(), "server/v2/followUpNotificationOutbox.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "drizzle-v2/0020_v2_follow_up_notification_outbox.sql"), "utf8");
const distribution = readFileSync(resolve(process.cwd(), "server/v2/distributionService.ts"), "utf8");

describe("follow-up notification outbox contract", () => {
  it("persists a versioned per-subscription idempotency boundary", () => {
    expect(migration).toContain("follow_up_notification_delivery_unique");
    expect(migration).toContain("`followUpId`,`notificationVersion`,`stage`,`subscriptionId`");
    expect(getTableConfig(followUps).columns.some(column => column.name === "notificationVersion")).toBe(true);
    expect(getTableConfig(followUpNotificationDeliveries).indexes.some(index => index.config.name === "follow_up_notification_delivery_unique" && index.config.unique)).toBe(true);
  });

  it("uses atomic insert, claim and terminal abandonment without retry", () => {
    expect(service).toContain(".onDuplicateKeyUpdate");
    expect(service).toContain("followUpNotificationAutomationEnabled");
    expect(service).toContain("return 0;");
    expect(service).toContain('eq(followUpNotificationDeliveries.status, "pending")');
    expect(service).toContain('status: "abandoned"');
    expect(service).not.toContain('status: "pending", claimToken: null');
  });

  it("invalidates outstanding eligibility when a pending follow-up changes owner", () => {
    expect(distribution).toContain("notificationVersion: sql`${followUps.notificationVersion} + 1`");
  });
});
