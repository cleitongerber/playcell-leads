import { describe, expect, it } from "vitest";
import { partnerDayBounds } from "./partnerTime";
import {
  campaignAllowsNewFollowUp,
  canTransitionFollowUp,
  derivedFollowUpStatus,
  nextPendingDueAt,
} from "./followUpPolicy";

describe("Follow-up V2 policy", () => {
  it("keeps only pending, completed and cancelled as persisted states", () => {
    const bounds = partnerDayBounds(
      "America/Sao_Paulo",
      new Date("2026-09-24T14:00:00.000Z")
    );
    expect(
      derivedFollowUpStatus(
        "pending",
        new Date("2026-09-24T02:00:00.000Z"),
        bounds.start
      )
    ).toBe("overdue");
    expect(
      derivedFollowUpStatus(
        "completed",
        new Date("2026-09-01T00:00:00.000Z"),
        bounds.start
      )
    ).toBe("completed");
  });

  it("uses the partner timezone to calculate the operational day", () => {
    const bounds = partnerDayBounds(
      "America/Sao_Paulo",
      new Date("2026-09-24T14:00:00.000Z")
    );
    expect(bounds.start.toISOString()).toBe("2026-09-24T03:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-09-25T03:00:00.000Z");
  });

  it("uses the earliest pending record as the lead cache", () => {
    const first = new Date("2026-09-25T12:00:00.000Z");
    const second = new Date("2026-09-26T12:00:00.000Z");
    expect(
      nextPendingDueAt([
        { status: "completed", dueAt: new Date("2026-09-24T12:00:00.000Z") },
        { status: "pending", dueAt: second },
        { status: "pending", dueAt: first },
      ])
    ).toEqual(first);
    expect(
      nextPendingDueAt([{ status: "cancelled", dueAt: first }])
    ).toBeNull();
  });

  it("blocks new or rescheduled work for frozen, closed and archived campaigns", () => {
    expect(campaignAllowsNewFollowUp("active", false)).toBe(true);
    expect(campaignAllowsNewFollowUp("active", true)).toBe(false);
    expect(campaignAllowsNewFollowUp("closed", false)).toBe(false);
    expect(campaignAllowsNewFollowUp("archived", false)).toBe(false);
  });

  it("models the conditional SQL transition used for idempotency and races", () => {
    expect(canTransitionFollowUp("pending", "completed")).toBe(true);
    expect(canTransitionFollowUp("completed", "completed")).toBe(true);
    expect(canTransitionFollowUp("completed", "cancelled")).toBe(false);
    expect(canTransitionFollowUp("cancelled", "completed")).toBe(false);
  });
});
