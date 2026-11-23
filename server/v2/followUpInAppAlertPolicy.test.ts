import { describe, expect, it } from "vitest";
import { inAppFollowUpStage, overdueBand } from "./followUpInAppAlertPolicy";

const zone = "America/Sao_Paulo";
describe("in-app follow-up alert policy", () => {
  it("emits PRE30, DUE and LATE60 only during the seven-minute operational tolerance", () => {
    const dueAt = new Date("2026-11-23T11:30:00.000Z"); // 08:30 São Paulo
    expect(inAppFollowUpStage({ status: "pending", dueAt, now: new Date("2026-11-23T11:00:00.000Z"), timeZone: zone })).toBe("PRE30");
    expect(inAppFollowUpStage({ status: "pending", dueAt, now: new Date("2026-11-23T11:30:00.000Z"), timeZone: zone })).toBe("DUE");
    expect(inAppFollowUpStage({ status: "pending", dueAt, now: new Date("2026-11-23T12:30:00.000Z"), timeZone: zone })).toBe("LATE60");
    expect(inAppFollowUpStage({ status: "pending", dueAt, now: new Date("2026-11-23T11:07:00.000Z"), timeZone: zone })).toBeNull();
  });
  it("suppresses non-pending records and Sunday, and keeps exclusive overdue bands", () => {
    const dueAt = new Date("2026-11-23T11:30:00.000Z");
    expect(inAppFollowUpStage({ status: "completed", dueAt, now: new Date("2026-11-23T11:30:00.000Z"), timeZone: zone })).toBeNull();
    expect(inAppFollowUpStage({ status: "pending", dueAt, now: new Date("2026-11-22T15:00:00.000Z"), timeZone: zone })).toBeNull();
    expect(overdueBand(dueAt, new Date(dueAt.getTime() + 60 * 60_000))).toBe("upToOneHour");
    expect(overdueBand(dueAt, new Date(dueAt.getTime() + 61 * 60_000))).toBe("oneTo24Hours");
    expect(overdueBand(dueAt, new Date(dueAt.getTime() + 25 * 60 * 60_000))).toBe("over24Hours");
  });
});
