import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_NOTIFICATION_TIMEZONE,
  eligibleFollowUpNotificationStages,
  followUpNotificationAutomationEnabled,
  isWithinFollowUpNotificationWindow,
  scheduledForFollowUpStage,
  terminalFollowUpNotificationStatus,
} from "./followUpNotificationPolicy";

describe("follow-up notification policy", () => {
  it("uses the three immutable stage offsets", () => {
    const dueAt = new Date("2026-11-23T17:00:00.000Z");
    expect(scheduledForFollowUpStage(dueAt, "PRE30").toISOString()).toBe("2026-11-23T16:30:00.000Z");
    expect(scheduledForFollowUpStage(dueAt, "DUE")).toEqual(dueAt);
    expect(scheduledForFollowUpStage(dueAt, "LATE60").toISOString()).toBe("2026-11-23T18:00:00.000Z");
  });

  it("uses an inclusive opening and exclusive closing in Sao Paulo", () => {
    expect(isWithinFollowUpNotificationWindow(new Date("2026-11-23T11:00:00.000Z"), FOLLOW_UP_NOTIFICATION_TIMEZONE)).toBe(true);
    expect(isWithinFollowUpNotificationWindow(new Date("2026-11-23T22:00:00.000Z"), FOLLOW_UP_NOTIFICATION_TIMEZONE)).toBe(false);
    expect(isWithinFollowUpNotificationWindow(new Date("2026-11-28T15:59:00.000Z"), FOLLOW_UP_NOTIFICATION_TIMEZONE)).toBe(true);
    expect(isWithinFollowUpNotificationWindow(new Date("2026-11-28T16:00:00.000Z"), FOLLOW_UP_NOTIFICATION_TIMEZONE)).toBe(false);
    expect(isWithinFollowUpNotificationWindow(new Date("2026-11-22T14:00:00.000Z"), FOLLOW_UP_NOTIFICATION_TIMEZONE)).toBe(false);
  });

  it("does not recover stages after the seven-minute tolerance", () => {
    const dueAt = new Date("2026-11-23T17:00:00.000Z");
    expect(eligibleFollowUpNotificationStages({ dueAt, now: new Date("2026-11-23T16:36:59.999Z") }).map(item => item.stage)).toEqual(["PRE30"]);
    expect(eligibleFollowUpNotificationStages({ dueAt, now: new Date("2026-11-23T16:37:00.000Z") })).toEqual([]);
  });

  it("skips stages whose own target is outside the business window", () => {
    const dueAt = new Date("2026-11-23T11:15:00.000Z"); // 08:15 BRT; PRE30 is 07:45.
    expect(eligibleFollowUpNotificationStages({ dueAt, now: new Date("2026-11-23T10:45:00.000Z") })).toEqual([]);
  });

  it("fails closed until both global and partner flags are explicitly enabled", () => {
    expect(followUpNotificationAutomationEnabled({})).toBe(false);
    expect(followUpNotificationAutomationEnabled({ WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "true" })).toBe(false);
    expect(followUpNotificationAutomationEnabled({}, { webPushFollowUpAutomationEnabled: true })).toBe(false);
    expect(followUpNotificationAutomationEnabled({ WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "true" }, { webPushFollowUpAutomationEnabled: true })).toBe(true);
  });

  it("never permits a terminal outbox state to be reclaimed", () => {
    expect(terminalFollowUpNotificationStatus("pending")).toBe(false);
    expect(terminalFollowUpNotificationStatus("sending")).toBe(false);
    expect(terminalFollowUpNotificationStatus("sent")).toBe(true);
    expect(terminalFollowUpNotificationStatus("abandoned")).toBe(true);
  });
});
