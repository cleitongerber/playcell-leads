import { describe, expect, it } from "vitest";
import {
  derivePortfolioPriority,
  matchesPortfolioOperationalFilter,
  portfolioPriorityRank,
} from "./leadPortfolioDomain";

const now = new Date("2026-10-10T15:00:00.000Z");
const dayEnd = new Date("2026-10-11T03:00:00.000Z");

const base = {
  isTerminal: false,
  hasAttempt: false,
  hasEffectiveContact: false,
  nextFollowUpAt: null,
  now,
  dayEnd,
};

describe("seller portfolio priority", () => {
  it("derives every operational priority from existing facts", () => {
    expect(
      derivePortfolioPriority({
        ...base,
        nextFollowUpAt: new Date("2026-10-10T14:59:00.000Z"),
      })
    ).toBe("overdue");
    expect(
      derivePortfolioPriority({
        ...base,
        nextFollowUpAt: new Date("2026-10-10T18:00:00.000Z"),
      })
    ).toBe("today");
    expect(derivePortfolioPriority(base)).toBe("unworked");
    expect(derivePortfolioPriority({ ...base, hasAttempt: true })).toBe(
      "attempting"
    );
    expect(
      derivePortfolioPriority({ ...base, hasEffectiveContact: true })
    ).toBe("in_progress");
    expect(
      derivePortfolioPriority({
        ...base,
        hasEffectiveContact: true,
        nextFollowUpAt: new Date("2026-10-11T12:00:00.000Z"),
      })
    ).toBe("upcoming");
    expect(derivePortfolioPriority({ ...base, isTerminal: true })).toBe(
      "terminal"
    );
  });

  it("keeps terminal leads terminal even with a residual follow-up", () => {
    expect(
      derivePortfolioPriority({
        ...base,
        isTerminal: true,
        nextFollowUpAt: new Date("2026-10-09T12:00:00.000Z"),
      })
    ).toBe("terminal");
  });

  it("keeps a reopened conversion in the active queue", () => {
    expect(
      derivePortfolioPriority({ ...base, hasEffectiveContact: true })
    ).not.toBe("terminal");
  });

  it("uses the approved priority order and compact operational filters", () => {
    expect(portfolioPriorityRank("overdue")).toBeLessThan(
      portfolioPriorityRank("today")
    );
    expect(portfolioPriorityRank("today")).toBeLessThan(
      portfolioPriorityRank("unworked")
    );
    expect(matchesPortfolioOperationalFilter("attempting", "action")).toBe(
      true
    );
    expect(matchesPortfolioOperationalFilter("in_progress", "action")).toBe(
      false
    );
    expect(matchesPortfolioOperationalFilter("upcoming", "returns")).toBe(true);
    expect(matchesPortfolioOperationalFilter("terminal", "closed")).toBe(true);
  });
});
