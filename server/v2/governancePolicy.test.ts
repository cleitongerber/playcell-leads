import { describe, expect, it } from "vitest";
import {
  assertAttemptGovernance,
  assertAllowedOutcomeCodes,
  assertSupportedGovernanceChannels,
  defaultAttemptGovernanceRule,
  assertContactGovernance,
  defaultGovernanceRule,
  evaluateAttemptGovernance,
  evaluateTreatmentGovernance,
  filterAllowedContactOutcomes,
  isContactOutcomeAllowed,
  isAttemptEvidenceRequiredForChannel,
  isEvidenceRequiredForChannel,
  resolveGovernanceForAttempt,
  resolveGovernanceForContact,
  selectEffectiveAttemptGovernance,
  selectEffectiveGovernance,
  tightenAttemptGovernance,
  type AttemptGovernanceRule,
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
    expect(isContactOutcomeAllowed(strictRule, "contacted")).toBe(true);
    expect(isContactOutcomeAllowed(strictRule, "sale_completed")).toBe(false);
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

  it("filters the treatment catalogue by stable outcome code and leaves an unrestricted rule intact", () => {
    const catalogue = [
      { id: 1, code: "contacted", label: "Cliente respondeu" },
      { id: 2, code: "sale_completed", label: "Venda realizada" },
    ];

    expect(filterAllowedContactOutcomes(strictRule, catalogue)).toEqual([
      catalogue[0],
    ]);
    expect(
      filterAllowedContactOutcomes(defaultGovernanceRule, catalogue)
    ).toEqual(catalogue);
  });

  it("accepts only active structured outcome codes in a restricted governance rule", () => {
    const rule = {
      ...defaultGovernanceRule,
      allowedOutcomes: ["sale_completed"],
    };
    expect(() =>
      assertAllowedOutcomeCodes(rule, ["interested", "sale_completed"])
    ).not.toThrow();
    expect(() =>
      assertAllowedOutcomeCodes(
        { ...rule, allowedOutcomes: ["Venda realizada"] },
        ["sale_completed"]
      )
    ).toThrow("Resultado permitido não reconhecido");
    expect(() => assertAllowedOutcomeCodes(rule, ["interested"])).toThrow(
      "Resultado permitido não reconhecido"
    );
  });

  it("accepts only the channels supported by the operational journey", () => {
    expect(() =>
      assertSupportedGovernanceChannels({
        allowedChannels: ["whatsapp", "ligação"],
        evidenceRequiredChannels: ["whatsapp"],
      })
    ).not.toThrow();
    expect(() =>
      assertSupportedGovernanceChannels({
        allowedChannels: ["telefone"],
        evidenceRequiredChannels: null,
      })
    ).toThrow("Canal de governança não reconhecido");
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

  it("allows evidence to be required only for configured channels and snapshots that decision", () => {
    const rule: GovernanceRule = {
      ...defaultGovernanceRule,
      evidenceRequiredChannels: ["whatsapp", "ligação"],
    };
    expect(isEvidenceRequiredForChannel(rule, "WhatsApp")).toBe(true);
    expect(isEvidenceRequiredForChannel(rule, "telefone")).toBe(false);
    expect(resolveGovernanceForContact(rule, "whatsapp")).toMatchObject({
      evidenceRequired: true,
      evidenceRequiredChannels: null,
    });
    expect(resolveGovernanceForContact(rule, "telefone")).toMatchObject({
      evidenceRequired: false,
      evidenceRequiredChannels: null,
    });
  });

  it("keeps the existing global evidence rule stronger than channel selection", () => {
    const rule: GovernanceRule = {
      ...defaultGovernanceRule,
      evidenceRequired: true,
      evidenceRequiredChannels: ["whatsapp"],
    };
    expect(isEvidenceRequiredForChannel(rule, "telefone")).toBe(true);
  });

  it("keeps attempt governance independent, channel-aware and snapshot-safe", () => {
    const rule: AttemptGovernanceRule = {
      ...defaultAttemptGovernanceRule,
      evidenceRequiredChannels: ["whatsapp"],
      noteRequired: true,
      allowedChannels: ["whatsapp"],
    };
    expect(isAttemptEvidenceRequiredForChannel(rule, "WhatsApp")).toBe(true);
    expect(isAttemptEvidenceRequiredForChannel(rule, "telefone")).toBe(false);
    expect(resolveGovernanceForAttempt(rule, "whatsapp")).toMatchObject({
      evidenceRequired: true,
      evidenceRequiredChannels: null,
    });
    expect(() =>
      assertAttemptGovernance(rule, { channel: "telefone", summary: "" })
    ).toThrow("Canal não permitido");
    expect(() =>
      assertAttemptGovernance(rule, { channel: "whatsapp", summary: "" })
    ).toThrow("observação");
    expect(
      evaluateAttemptGovernance(resolveGovernanceForAttempt(rule, "whatsapp"), {
        hasNote: true,
        hasEvidence: false,
      })
    ).toMatchObject({ evidenceSatisfied: false, isComplete: false });
  });

  it("uses a campaign attempt override only when its independent mode is enabled", () => {
    const partner = {
      ...defaultAttemptGovernanceRule,
      evidenceRequired: true,
    };
    const campaign = {
      ...defaultAttemptGovernanceRule,
      noteRequired: true,
    };
    expect(selectEffectiveAttemptGovernance(partner, null)).toEqual({
      source: "partner",
      rule: partner,
    });
    expect(selectEffectiveAttemptGovernance(partner, campaign)).toEqual({
      source: "campaign",
      rule: campaign,
    });
  });

  it("never lets a future structured result weaken an attempt requirement", () => {
    const strict = {
      ...defaultAttemptGovernanceRule,
      evidenceRequired: true,
      noteRequired: true,
    };
    expect(tightenAttemptGovernance(strict, {})).toMatchObject({
      evidenceRequired: true,
      noteRequired: true,
    });
    expect(
      tightenAttemptGovernance(defaultAttemptGovernanceRule, {
        evidenceRequired: true,
      })
    ).toMatchObject({ evidenceRequired: true });
  });
});
