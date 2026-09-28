import { describe, expect, it } from "vitest";
import { assertConversionSource } from "./leadConversionPolicy";

const eligibleConversion = {
  contactRecordKind: "effective_contact" as const,
  resultInteractionKind: "effective_contact" as const,
  resultConversionMode: "eligible" as const,
  statusIsTerminal: true,
  statusCategory: "completed" as const,
};

describe("lead conversion foundation policy", () => {
  it("requires an effective-contact event and a terminal conversion status", () => {
    expect(assertConversionSource(eligibleConversion)).toBe(true);
    expect(() =>
      assertConversionSource({
        ...eligibleConversion,
        contactRecordKind: "legacy",
      })
    ).toThrow("contato efetivo");
    expect(() =>
      assertConversionSource({
        ...eligibleConversion,
        resultConversionMode: "none",
      })
    ).toThrow("não é elegível");
    expect(() =>
      assertConversionSource({ ...eligibleConversion, statusIsTerminal: false })
    ).toThrow("situação terminal");
  });
});
