import { describe, expect, it } from "vitest";
import {
  presentNextLeadAction,
  usesSeparatedLeadJourney,
} from "./leadJourneyPresentation";

describe("separated lead journey presentation", () => {
  it("fails closed to the legacy workspace unless the backend explicitly enables it", () => {
    expect(usesSeparatedLeadJourney(undefined)).toBe(false);
    expect(usesSeparatedLeadJourney("legacy")).toBe(false);
    expect(usesSeparatedLeadJourney("separated_contact_v1")).toBe(true);
  });

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
