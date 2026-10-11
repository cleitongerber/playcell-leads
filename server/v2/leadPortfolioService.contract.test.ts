import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/v2/leadService.ts"),
  "utf8"
);
const router = readFileSync(
  resolve(process.cwd(), "server/v2/router.ts"),
  "utf8"
);

describe("seller portfolio list contract", () => {
  it("aggregates operational facts once per partner and Lead", () => {
    expect(source).toContain("function createPortfolioFacts");
    expect(source).toContain(
      "leadContactAttempts.partnerId, context.partnerId"
    );
    expect(source).toContain("leadContacts.partnerId, context.partnerId");
    expect(source).toContain("followUps.partnerId, context.partnerId");
    expect(source).toContain("leadConversions.partnerId, context.partnerId");
    expect(source).toContain("min(followUps.dueAt)");
    expect(source).toContain("eq(facts.attempts.partnerId, leads.partnerId)");
    expect(source).toContain("eq(facts.pendingFollowUps.leadId, leads.id)");
  });

  it("applies priority and operational filters before pagination only in Minha carteira", () => {
    expect(source).toContain('if (input.view !== "mine")');
    expect(source).toContain("const priorityRank = sql<number>`case");
    expect(source).toContain("priorityRank} in (1, 2, 3, 4)");
    expect(source).toContain("priorityRank} in (1, 2, 6)");
    expect(source).toContain(".orderBy(");
    expect(source).toContain(".limit(pageSize)");
    expect(source).toContain(
      ".offset((Math.max(input.page, 1) - 1) * pageSize)"
    );
    expect(router).toContain(
      '.enum(["all", "action", "unworked", "returns", "closed"])'
    );
  });

  it("keeps terminal state above residual follow-ups and returns the complete projection", () => {
    expect(source).toContain("when ${leadStatuses.isTerminal} then 7");
    for (const field of [
      "attemptCount",
      "lastAttemptAt",
      "lastAttemptChannel",
      "lastAttemptResult",
      "hasEffectiveContact",
      "lastEffectiveContactAt",
      "pendingNextFollowUpAt",
      "pendingFollowUpCount",
      "isTerminal",
      "conversionAt",
    ]) {
      expect(source).toContain(field);
    }
  });
});
