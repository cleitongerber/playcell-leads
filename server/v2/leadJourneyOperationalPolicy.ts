import type {
  LeadInteractionConversionMode,
  LeadInteractionFollowUpPolicy,
  LeadInteractionStatusPolicy,
  LeadStatusCategory,
} from "../../drizzle-v2/schema";
import type { PartnerRole } from "./access";

/**
 * Domain errors from the unified operational journey deliberately carry a
 * stable code for the UI and retry boundary.
 */
export class LeadJourneyOperationError extends Error {
  constructor(
    public readonly code:
      | "LEAD_OPERATION_IN_PROGRESS"
      | "LEAD_STATUS_CONFLICT"
      | "ADMINISTRATIVE_STATUS_FORBIDDEN"
      | "LEAD_REOPEN_FORBIDDEN"
      | "INVALID_RESULT_CONFIGURATION",
    message: string
  ) {
    super(message);
    this.name = "LeadJourneyOperationError";
  }
}

export type EffectiveContactResultPolicy = {
  statusPolicy: LeadInteractionStatusPolicy;
  suggestedStatusId: number | null;
  allowSellerOverride: boolean;
  followUpPolicy: LeadInteractionFollowUpPolicy;
  conversionMode: LeadInteractionConversionMode;
};

/**
 * Resolves the final current-state mutation independently from the result
 * label. `require` always binds the operation to the configured status;
 * `suggest` can be overridden only by a seller explicitly allowed to do so.
 */
export function resolveEffectiveContactFinalStatus(input: {
  role: PartnerRole;
  policy: EffectiveContactResultPolicy;
  requestedStatusId?: number | null;
}) {
  const { policy } = input;
  const requested = input.requestedStatusId ?? null;

  if (policy.statusPolicy === "none") return requested;

  if (!policy.suggestedStatusId) {
    throw new LeadJourneyOperationError(
      "INVALID_RESULT_CONFIGURATION",
      "Resultado configurado sem situação sugerida"
    );
  }

  if (policy.statusPolicy === "require") {
    if (requested && requested !== policy.suggestedStatusId) {
      throw new LeadJourneyOperationError(
        "INVALID_RESULT_CONFIGURATION",
        "Este resultado exige a situação configurada"
      );
    }
    return policy.suggestedStatusId;
  }

  const finalStatusId = requested ?? policy.suggestedStatusId;
  if (
    input.role === "seller" &&
    finalStatusId !== policy.suggestedStatusId &&
    !policy.allowSellerOverride
  ) {
    throw new LeadJourneyOperationError(
      "INVALID_RESULT_CONFIGURATION",
      "O vendedor não pode alterar a situação sugerida para este resultado"
    );
  }
  return finalStatusId;
}

/** A result can strengthen governance; it cannot make an existing requirement weaker. */
export function isFollowUpRequired(input: {
  governanceRequiresFollowUp: boolean;
  resultPolicy: LeadInteractionFollowUpPolicy;
}) {
  return input.governanceRequiresFollowUp || input.resultPolicy === "required";
}

/**
 * `not_applicable` prevents an arbitrary new task for that result unless a
 * stricter governance rule independently requires the task. This preserves
 * partner governance as the upper bound rather than letting catalog setup
 * weaken it.
 */
export function assertFollowUpApplicability(input: {
  governanceRequiresFollowUp: boolean;
  resultPolicy: LeadInteractionFollowUpPolicy;
  hasFollowUp: boolean;
}) {
  if (
    input.hasFollowUp &&
    input.resultPolicy === "not_applicable" &&
    !input.governanceRequiresFollowUp
  ) {
    throw new LeadJourneyOperationError(
      "INVALID_RESULT_CONFIGURATION",
      "Este resultado não permite agendar um novo follow-up"
    );
  }
  return true;
}

export function assertAdministrativeStatusRole(role: PartnerRole) {
  if (role === "seller") {
    throw new LeadJourneyOperationError(
      "ADMINISTRATIVE_STATUS_FORBIDDEN",
      "Vendedor não pode fazer ajuste administrativo de situação"
    );
  }
  return true;
}

export function assertReopenRole(role: PartnerRole) {
  if (role === "seller") {
    throw new LeadJourneyOperationError(
      "LEAD_REOPEN_FORBIDDEN",
      "Vendedor não pode reabrir lead"
    );
  }
  return true;
}

export function requiresAdministrativeStatusReason(input: {
  previousIsTerminal: boolean;
  nextIsTerminal: boolean;
}) {
  return input.previousIsTerminal || input.nextIsTerminal;
}

export function assertLeadAcceptsCommercialOperation(isTerminal: boolean) {
  if (isTerminal) {
    throw new LeadJourneyOperationError(
      "INVALID_RESULT_CONFIGURATION",
      "Reabra o lead antes de registrar uma nova ação comercial"
    );
  }
  return true;
}

/** A terminal-to-open transition is a reactivation, never a silent status edit. */
export function assertAdministrativeStatusTransition(input: {
  previousIsTerminal: boolean;
  nextIsTerminal: boolean;
}) {
  if (input.previousIsTerminal && !input.nextIsTerminal) {
    throw new LeadJourneyOperationError(
      "LEAD_REOPEN_FORBIDDEN",
      "Use a ação de reabrir lead para sair de uma situação terminal"
    );
  }
  return true;
}

export function assertConversionStatus(input: {
  conversionMode: LeadInteractionConversionMode;
  statusIsTerminal: boolean;
  statusCategory: LeadStatusCategory;
}) {
  if (input.conversionMode !== "eligible") return false;
  if (!input.statusIsTerminal || input.statusCategory !== "completed") {
    throw new LeadJourneyOperationError(
      "INVALID_RESULT_CONFIGURATION",
      "Resultado de conversão exige uma situação terminal de conversão"
    );
  }
  return true;
}
