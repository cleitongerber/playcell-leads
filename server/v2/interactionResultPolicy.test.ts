import { describe, expect, it } from "vitest";
import {
  assertInteractionResultKind,
  normalizeInteractionResultConfiguration,
} from "./interactionResultPolicy";

const base = {
  interactionKind: "effective_contact" as const,
  code: "sale_completed",
  label: "Venda realizada",
  category: "conversion",
  suggestedStatusId: 10,
  statusPolicy: "require" as const,
  allowSellerOverride: false,
  followUpPolicy: "not_applicable" as const,
  conversionMode: "eligible" as const,
  isActive: true,
  sortOrder: 10,
};

describe("interaction result configuration policy", () => {
  it("uses stable codes and never derives behavior from the display label", () => {
    expect(
      normalizeInteractionResultConfiguration({
        ...base,
        code: " Sale_Completed ",
        label: "Fechamento confirmado",
      })
    ).toMatchObject({
      code: "sale_completed",
      label: "Fechamento confirmado",
      conversionMode: "eligible",
    });
  });

  it("rejects incoherent conversion and status configurations", () => {
    expect(() =>
      normalizeInteractionResultConfiguration({
        ...base,
        interactionKind: "attempt",
      })
    ).toThrow("contato efetivo");
    expect(() =>
      normalizeInteractionResultConfiguration({
        ...base,
        statusPolicy: "suggest",
      })
    ).toThrow("situação obrigatória");
    expect(() =>
      normalizeInteractionResultConfiguration({
        ...base,
        statusPolicy: "none",
        suggestedStatusId: null,
        conversionMode: "none",
      })
    ).not.toThrow();
  });

  it("does not allow results to cross attempt and effective-contact commands", () => {
    expect(assertInteractionResultKind("attempt", "attempt")).toBe(true);
    expect(() =>
      assertInteractionResultKind("attempt", "effective_contact")
    ).toThrow("não pertence");
  });
});
