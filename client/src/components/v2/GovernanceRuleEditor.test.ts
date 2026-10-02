import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  blankGovernanceRule,
  governanceFormToInput,
  hasInvalidGovernanceRuleSelection,
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
  });
});
