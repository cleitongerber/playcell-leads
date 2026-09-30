import { describe, expect, it } from "vitest";
import { deriveNextLeadAction } from "./leadJourneyDomain";

const baseInput = {
  timeZone: "America/Sao_Paulo",
  now: new Date("2026-09-28T15:00:00.000Z"),
  hasBlockingGovernance: false,
  isTerminal: false,
  hasEffectiveContact: false,
};

describe("unified lead journey domain", () => {
  it("keeps blocking governance above a terminal lead and all follow-ups", () => {
    expect(
      deriveNextLeadAction({
        ...baseInput,
        hasBlockingGovernance: true,
        isTerminal: true,
        pendingFollowUps: [{ dueAt: new Date("2026-09-27T15:00:00.000Z") }],
      })
    ).toEqual({ kind: "complete_governance", hasResidualFollowUp: true });
  });

  it("does not recommend commercial work on a terminal lead with a residual follow-up", () => {
    expect(
      deriveNextLeadAction({
        ...baseInput,
        isTerminal: true,
        pendingFollowUps: [{ dueAt: new Date("2026-09-27T15:00:00.000Z") }],
      })
    ).toEqual({ kind: "lead_terminal", hasResidualFollowUp: true });
  });

  it("returns a read-only operational state for a frozen or closed campaign", () => {
    expect(
      deriveNextLeadAction({
        ...baseInput,
        isCampaignOperational: false,
        pendingFollowUps: [{ dueAt: new Date("2026-09-28T18:00:00.000Z") }],
      })
    ).toEqual({ kind: "campaign_not_operational", hasResidualFollowUp: true });
  });

  it("keeps terminal state above campaign and residual follow-up suggestions", () => {
    expect(
      deriveNextLeadAction({
        ...baseInput,
        isTerminal: true,
        isCampaignOperational: false,
      })
    ).toEqual({ kind: "lead_terminal", hasResidualFollowUp: false });
  });

  it("uses the partner timezone to distinguish overdue and today follow-ups", () => {
    expect(
      deriveNextLeadAction({
        ...baseInput,
        pendingFollowUps: [{ dueAt: new Date("2026-09-28T02:00:00.000Z") }],
      }).kind
    ).toBe("complete_overdue_follow_up");
    expect(
      deriveNextLeadAction({
        ...baseInput,
        pendingFollowUps: [{ dueAt: new Date("2026-09-28T18:00:00.000Z") }],
      }).kind
    ).toBe("complete_today_follow_up");
  });

  it("separates a first attempt from an effective contact and reads only the latest attempt state", () => {
    expect(deriveNextLeadAction(baseInput).kind).toBe(
      "make_first_contact_attempt"
    );
    expect(
      deriveNextLeadAction({
        ...baseInput,
        attempts: [
          {
            category: "invalid_contact",
            occurredAt: new Date("2026-09-28T13:00:00.000Z"),
          },
          {
            category: "awaiting_response",
            occurredAt: new Date("2026-09-28T14:00:00.000Z"),
          },
        ],
      }).kind
    ).toBe("await_response");
    expect(
      deriveNextLeadAction({
        ...baseInput,
        attempts: [
          {
            category: "invalid_contact",
            occurredAt: new Date("2026-09-28T14:00:00.000Z"),
          },
        ],
      }).kind
    ).toBe("resolve_invalid_contact");
  });
});
