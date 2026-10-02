import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const service = read("server/v2/followUpService.ts");
const journey = read("server/v2/leadJourneyService.ts");
const router = read("server/v2/router.ts");
const workspace = read("client/src/components/v2/V2SeparatedLeadJourney.tsx");
const central = read("client/src/pages/V2FollowUps.tsx");
const completionDialog = read(
  "client/src/components/v2/FollowUpCompletionDialog.tsx"
);
const cancellationDialog = read(
  "client/src/components/v2/FollowUpCancellationDialog.tsx"
);

describe("023 auditable follow-up completion contract", () => {
  it("does not expose a direct completion mutation without an explicit reason", () => {
    expect(router).toContain("reason: z.string().trim().min(1).max(5_000)");
    expect(service).toContain("Motivo da conclusão obrigatório");
    expect(service).toContain('completionKind: "without_contact"');
    expect(service).toContain('type: "follow_up_completed"');
  });

  it("keeps cancellation distinct and records its mandatory reason", () => {
    expect(service).toContain("Motivo do cancelamento obrigatório");
    expect(service).toContain('type: "follow_up_cancelled"');
    expect(cancellationDialog).toContain("Motivo do cancelamento");
    expect(cancellationDialog).toContain("!reason.trim()");
  });

  it("completes a follow-up only after the reused attempt or treatment is valid", () => {
    expect(journey).toContain("completeFollowUpFromOperationalFact");
    expect(journey).toContain('completionKind: "attempt"');
    expect(journey).toContain('completionKind: "treatment"');
    expect(journey).toContain("completionTimelineEventId: timelineEventId");
    expect(journey).toContain("rule.evidenceRequired && !input.evidence");
    expect(journey).toContain("assertContactGovernance");
    expect(journey).toContain("assertConversionSource");
  });

  it("uses one completion choice flow from Lead detail and the central", () => {
    expect(workspace).toContain("FollowUpCompletionDialog");
    expect(workspace).toContain("completeFollowUpId: completionFollowUpId");
    expect(central).toContain("FollowUpCompletionDialog");
    expect(central).toContain("completeFollowUpId");
    expect(completionDialog).toContain("Registrei uma tentativa de contato");
    expect(completionDialog).toContain("Houve interação com o cliente");
    expect(completionDialog).toContain("Concluir sem contato");
    expect(completionDialog).toContain("Motivo da conclusão");
    expect(completionDialog).toContain(
      "max-h-[calc(100dvh-2rem)] overflow-y-auto"
    );
  });

  it("uses a conditional pending transition to keep concurrent completion idempotent", () => {
    expect(service).toContain('eq(followUps.status, "pending")');
    expect(service).toContain(
      "Este follow-up já foi atualizado por outro usuário"
    );
    expect(service).toContain("completionTimelineEventId");
  });
});
