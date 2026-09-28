import type {
  LeadInteractionConversionMode,
  LeadInteractionFollowUpPolicy,
  LeadInteractionKind,
  LeadInteractionStatusPolicy,
} from "../../drizzle-v2/schema";

export type InteractionResultConfiguration = {
  interactionKind: LeadInteractionKind;
  code: string;
  label: string;
  category: string;
  suggestedStatusId: number | null;
  statusPolicy: LeadInteractionStatusPolicy;
  allowSellerOverride: boolean;
  followUpPolicy: LeadInteractionFollowUpPolicy;
  conversionMode: LeadInteractionConversionMode;
  isActive: boolean;
  sortOrder: number;
};

const STABLE_CODE = /^[a-z][a-z0-9_-]{0,63}$/;

function normalizedStableCode(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!STABLE_CODE.test(normalized)) {
    throw new Error(`${label} inválido`);
  }
  return normalized;
}

/**
 * Validates configuration semantics without relying on display labels. Status
 * ownership and terminal category are checked by the tenant-aware service.
 */
export function normalizeInteractionResultConfiguration(
  input: InteractionResultConfiguration
): InteractionResultConfiguration {
  const code = normalizedStableCode(input.code, "Código do resultado");
  const category = normalizedStableCode(
    input.category,
    "Categoria do resultado"
  );
  const label = input.label.trim();
  if (!label || label.length > 120) {
    throw new Error("Nome do resultado inválido");
  }
  if (input.statusPolicy === "none" && input.suggestedStatusId !== null) {
    throw new Error("Uma situação sugerida exige uma política de situação");
  }
  if (
    input.statusPolicy !== "none" &&
    (!input.suggestedStatusId || input.suggestedStatusId < 1)
  ) {
    throw new Error("Uma política de situação exige uma situação sugerida");
  }
  if (
    input.conversionMode === "eligible" &&
    input.interactionKind !== "effective_contact"
  ) {
    throw new Error("Apenas contato efetivo pode ser elegível para conversão");
  }
  if (input.conversionMode === "eligible" && input.statusPolicy !== "require") {
    throw new Error("Resultado de conversão exige uma situação obrigatória");
  }
  return {
    ...input,
    code,
    label,
    category,
  };
}

/** Future command handlers must not attach an attempt result to a contact. */
export function assertInteractionResultKind(
  expected: LeadInteractionKind,
  actual: LeadInteractionKind
) {
  if (expected !== actual) {
    throw new Error("Resultado não pertence a este tipo de operação");
  }
  return true;
}
