import { describe, expect, it } from "vitest";
import { presentNextLeadAction } from "./leadJourneyPresentation";

describe("unified lead journey presentation", () => {
  it("presents backend next-action states without deriving commercial rules in React", () => {
    expect(
      presentNextLeadAction({
        kind: "make_first_contact_attempt",
        hasResidualFollowUp: false,
      })
    ).toMatchObject({
      title: "Faça a primeira tentativa de contato",
      cta: "contact",
    });
    expect(
      presentNextLeadAction({
        kind: "complete_governance",
        hasResidualFollowUp: false,
      })
    ).toMatchObject({ cta: "evidence", tone: "warning" });
  });

  it("does not turn a residual follow-up on a terminal lead into a commercial CTA", () => {
    expect(
      presentNextLeadAction({
        kind: "lead_terminal",
        hasResidualFollowUp: true,
      })
    ).toMatchObject({
      cta: "none",
      description:
        "Há um follow-up anterior pendente para revisão, mas nenhuma nova ação comercial é sugerida.",
    });
  });
});
