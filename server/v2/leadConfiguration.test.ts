import { describe, expect, it } from "vitest";
import { defaultInteractionResults } from "./leadConfiguration";

describe("016.1 interaction result defaults", () => {
  it("uses stable codes instead of labels for the two interaction kinds", () => {
    const attempts = defaultInteractionResults.filter(
      result => result.interactionKind === "attempt"
    );
    const effectiveContacts = defaultInteractionResults.filter(
      result => result.interactionKind === "effective_contact"
    );

    expect(attempts.map(result => result.code)).toEqual([
      "message_sent",
      "no_answer",
      "busy",
      "voicemail",
      "invalid_contact",
      "other_attempt",
    ]);
    expect(effectiveContacts.map(result => result.code)).toEqual([
      "interested",
      "return_later",
      "not_interested",
      "sale_completed",
      "other_contact",
    ]);
    expect(
      effectiveContacts.find(result => result.code === "sale_completed")
    ).toMatchObject({
      category: "conversion",
      suggestedStatusCode: "converted",
      statusPolicy: "require",
      allowSellerOverride: false,
      conversionMode: "eligible",
    });
  });

  it("keeps the attempt result for an unanswered message out of effective contact", () => {
    expect(
      defaultInteractionResults.find(result => result.code === "message_sent")
    ).toMatchObject({
      interactionKind: "attempt",
      category: "awaiting_response",
      conversionMode: "none",
    });
  });
});
