import { describe, expect, it } from "vitest";
import {
  assertContactGovernance,
  defaultGovernanceRule,
  evaluateTreatmentGovernance,
  selectEffectiveGovernance,
  type GovernanceRule,
} from "./governancePolicy";

const strictRule: GovernanceRule = {
  ...defaultGovernanceRule,
  evidenceRequired: true,
  noteRequired: true,
  followUpRequired: true,
  allowedChannels: ["whatsapp"],
  allowedOutcomes: ["contacted"],
};

describe("V2 governance policy", () => {
  it("keeps optional evidence from blocking a treatment and flags required evidence as incomplete", () => {
    expect(
      evaluateTreatmentGovernance(defaultGovernanceRule, {
        hasNote: false,
        hasFollowUp: false,
        hasEvidence: false,
      }).isComplete
    ).toBe(true);
    expect(
      evaluateTreatmentGovernance(strictRule, {
        hasNote: true,
        hasFollowUp: true,
        hasEvidence: false,
      })
    ).toMatchObject({ evidenceSatisfied: false, isComplete: false });
  });

  it("enforces only the configured note, follow-up, channel and outcome requirements", () => {
    expect(() =>
      assertContactGovernance(strictRule, {
        channel: "telefone",
        outcome: "contacted",
        summary: "Cliente respondeu",
        followUpDueAt: new Date(),
      })
    ).toThrow("Canal não permitido");
    expect(() =>
      assertContactGovernance(strictRule, {
        channel: "whatsapp",
        outcome: "other",
        summary: "Cliente respondeu",
        followUpDueAt: new Date(),
      })
    ).toThrow("Resultado não permitido");
    expect(() =>
      assertContactGovernance(strictRule, {
        channel: "whatsapp",
        outcome: "contacted",
        summary: "",
        followUpDueAt: undefined,
      })
    ).toThrow("observação");
    expect(() =>
      assertContactGovernance(strictRule, {
        channel: "whatsapp",
        outcome: "contacted",
        summary: "Cliente respondeu",
        followUpDueAt: undefined,
      })
    ).toThrow("follow-up");
  });

  it("uses a campaign override only when one exists", () => {
    const partner = { ...defaultGovernanceRule, noteRequired: true };
    const campaign = { ...defaultGovernanceRule, evidenceRequired: true };
    expect(selectEffectiveGovernance(partner, null)).toEqual({
      source: "partner",
      rule: partner,
    });
    expect(selectEffectiveGovernance(partner, campaign)).toEqual({
      source: "campaign",
      rule: campaign,
    });
  });
});
