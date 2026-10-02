import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  blankGovernanceRule,
  governanceFormToInput,
  governanceRuleToForm,
  governanceRuleIssueAnchor,
  governanceRuleValidationIssues,
  hasInvalidGovernanceRuleSelection,
  reviewedGovernanceChannelCodes,
  reviewedGovernanceOutcomeCodes,
  unrecognizedGovernanceChannelCodes,
  unrecognizedGovernanceOutcomeCodes,
} from "./GovernanceRuleEditor";

const outcomes = [
  { code: "interested", label: "Interessado" },
  { code: "sale_completed", label: "Venda realizada" },
];

describe("GovernanceRuleEditor", () => {
  it("persists an unrestricted selection as the existing null semantics", () => {
    expect(
      governanceFormToInput({ ...blankGovernanceRule, allowedOutcomes: null })
        .allowedOutcomes
    ).toBeNull();
  });

  it("persists selected labels through their stable outcome codes", () => {
    expect(
      governanceFormToInput({
        ...blankGovernanceRule,
        allowedOutcomes: ["sale_completed"],
      }).allowedOutcomes
    ).toEqual(["sale_completed"]);
  });

  it("flags legacy labels and prevents an empty specific selection", () => {
    const legacy = {
      ...blankGovernanceRule,
      allowedOutcomes: ["interessado"],
    };
    expect(unrecognizedGovernanceOutcomeCodes(legacy, outcomes)).toEqual([
      "interessado",
    ]);
    expect(hasInvalidGovernanceRuleSelection(legacy, outcomes)).toBe(true);
    expect(
      hasInvalidGovernanceRuleSelection(
        { ...blankGovernanceRule, allowedOutcomes: [] },
        outcomes
      )
    ).toBe(true);
  });

  it("flags legacy free-text channel values for review", () => {
    const legacy = {
      ...blankGovernanceRule,
      allowedChannels: ["telefone"],
      evidenceRequiredChannels: ["email"],
    };
    expect(unrecognizedGovernanceChannelCodes(legacy)).toEqual([
      "telefone",
      "email",
    ]);
    expect(hasInvalidGovernanceRuleSelection(legacy, outcomes)).toBe(true);
  });

  it("unblocks a reviewed legacy outcome selection without converting it automatically", () => {
    const legacy = {
      ...blankGovernanceRule,
      allowedOutcomes: ["interessado"],
    };
    expect(governanceRuleValidationIssues(legacy, outcomes)).toHaveLength(1);

    const reviewed = {
      ...legacy,
      allowedOutcomes: [
        ...(reviewedGovernanceOutcomeCodes(legacy.allowedOutcomes, outcomes) ??
          []),
        "interested",
        "sale_completed",
      ],
    };
    expect(reviewed.allowedOutcomes).toEqual(["interested", "sale_completed"]);
    expect(governanceRuleValidationIssues(reviewed, outcomes)).toEqual([]);
    expect(governanceFormToInput(reviewed).allowedOutcomes).toEqual([
      "interested",
      "sale_completed",
    ]);
  });

  it("unblocks a reviewed legacy channel selection while retaining other unresolved fields", () => {
    const legacy = {
      ...blankGovernanceRule,
      allowedChannels: ["telefone"],
      evidenceRequiredChannels: ["email"],
    };
    const reviewedAllowedChannels = {
      ...legacy,
      allowedChannels: [
        ...(reviewedGovernanceChannelCodes(legacy.allowedChannels) ?? []),
        "whatsapp",
      ],
    };
    expect(
      governanceRuleValidationIssues(reviewedAllowedChannels, outcomes)
    ).toEqual([expect.objectContaining({ field: "evidenceRequiredChannels" })]);

    const fullyReviewed = {
      ...reviewedAllowedChannels,
      evidenceRequiredChannels: [
        ...(reviewedGovernanceChannelCodes(legacy.evidenceRequiredChannels) ??
          []),
        "ligação",
      ],
    };
    expect(governanceRuleValidationIssues(fullyReviewed, outcomes)).toEqual([]);
    expect(governanceFormToInput(fullyReviewed)).toMatchObject({
      allowedChannels: ["whatsapp"],
      evidenceRequiredChannels: ["ligação"],
    });
  });

  it("does not retain an irrelevant legacy evidence channel when evidence is required for all channels", () => {
    const form = governanceRuleToForm({
      evidenceRequired: true,
      evidenceRequiredChannels: ["telefone"],
      noteRequired: false,
      followUpRequired: false,
      allowedChannels: null,
      allowedOutcomes: null,
      allowedEvidenceMimeTypes: null,
      maxEvidenceSizeBytes: 3 * 1024 * 1024,
      retentionDays: 365,
    });
    expect(form.evidenceRequiredChannels).toEqual([]);
    expect(governanceRuleValidationIssues(form, outcomes)).toEqual([]);
    expect(governanceFormToInput(form).evidenceRequiredChannels).toBeNull();
  });

  it("provides a visible issue for every client-side save blocker", () => {
    const invalid = {
      ...blankGovernanceRule,
      allowedChannels: [],
      allowedOutcomes: [],
      maxEvidenceSizeMb: "11",
      retentionDays: "0",
    };
    expect(
      governanceRuleValidationIssues(invalid, outcomes).map(
        issue => issue.field
      )
    ).toEqual([
      "allowedChannels",
      "allowedOutcomes",
      "maxEvidenceSizeMb",
      "retentionDays",
    ]);
  });

  it("keeps the same review links available for partner and campaign forms", () => {
    expect(governanceRuleIssueAnchor("allowedOutcomes")).toBe(
      "governance-allowed-outcomes"
    );
    const governancePage = readFileSync(
      resolve(process.cwd(), "client/src/pages/V2Governance.tsx"),
      "utf8"
    );
    const campaignPage = readFileSync(
      resolve(process.cwd(), "client/src/pages/V2Campaigns.tsx"),
      "utf8"
    );
    expect(governancePage).toContain("governanceRuleIssueAnchor");
    expect(campaignPage).toContain("governanceRuleIssueAnchor");
  });

  it("renders administrative choices from labels instead of free-text policy fields", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/components/v2/GovernanceRuleEditor.tsx"
      ),
      "utf8"
    );
    expect(source).toContain("outcome.label");
    expect(source).toContain("Todos os resultados ativos");
    expect(source).toContain("Selecionar resultados específicos");
    expect(source).toContain("governanceChannels.map");
    expect(source).not.toContain("separados por vírgula");
    expect(source).not.toContain("Textarea");
    expect(source).toContain("Revise a seleção antes de salvar");
  });
});
