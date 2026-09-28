import type {
  LeadContactRecordKind,
  LeadInteractionConversionMode,
  LeadInteractionKind,
  LeadStatusCategory,
} from "../../drizzle-v2/schema";

/**
 * The future conversion command must use this semantic guard in addition to
 * the tenant-scoped database foreign keys. SQL cannot express that a related
 * contact row has a particular enum value.
 */
export function assertConversionSource(input: {
  contactRecordKind: LeadContactRecordKind;
  resultInteractionKind: LeadInteractionKind;
  resultConversionMode: LeadInteractionConversionMode;
  statusIsTerminal: boolean;
  statusCategory: LeadStatusCategory;
}) {
  if (input.contactRecordKind !== "effective_contact") {
    throw new Error("Conversão exige um contato efetivo");
  }
  if (input.resultInteractionKind !== "effective_contact") {
    throw new Error("Conversão exige um resultado de contato efetivo");
  }
  if (input.resultConversionMode !== "eligible") {
    throw new Error("Resultado não é elegível para conversão");
  }
  if (!input.statusIsTerminal || input.statusCategory !== "completed") {
    throw new Error("Conversão exige uma situação terminal de conversão");
  }
  return true;
}
