import type { LeadJourneyMode } from "../../drizzle-v2/schema";
import { partnerDayBounds } from "./partnerTime";

/** A missing or unrecognized setting always fails closed to the legacy journey. */
export function normalizeLeadJourneyMode(value: unknown): LeadJourneyMode {
  return value === "separated_contact_v1" ? value : "legacy";
}

export function usesSeparatedContactJourney(value: unknown) {
  return normalizeLeadJourneyMode(value) === "separated_contact_v1";
}

export type PendingLeadFollowUp = {
  dueAt: Date;
};

export type LeadAttemptSignal = {
  category: string;
  occurredAt: Date;
};

export type NextLeadAction =
  | {
      kind: "complete_governance";
      hasResidualFollowUp: boolean;
    }
  | {
      kind: "lead_terminal";
      hasResidualFollowUp: boolean;
    }
  | {
      kind: "complete_overdue_follow_up";
      hasResidualFollowUp: boolean;
    }
  | {
      kind: "complete_today_follow_up";
      hasResidualFollowUp: boolean;
    }
  | {
      kind: "make_first_contact_attempt";
      hasResidualFollowUp: false;
    }
  | {
      kind: "await_response";
      hasResidualFollowUp: false;
    }
  | {
      kind: "resolve_invalid_contact";
      hasResidualFollowUp: false;
    }
  | {
      kind: "continue_lead_work";
      hasResidualFollowUp: false;
    };

export type DeriveNextLeadActionInput = {
  timeZone: string;
  now?: Date;
  hasBlockingGovernance: boolean;
  isTerminal: boolean;
  pendingFollowUps?: readonly PendingLeadFollowUp[];
  attempts?: readonly LeadAttemptSignal[];
  hasEffectiveContact: boolean;
};

function latestAttempt(attempts: readonly LeadAttemptSignal[]) {
  return attempts.reduce<LeadAttemptSignal | null>(
    (latest, attempt) =>
      !latest || attempt.occurredAt > latest.occurredAt ? attempt : latest,
    null
  );
}

/**
 * Pure priority policy for the future operational screen. It deliberately has
 * no database access and no effects, so callers can compute a deterministic
 * recommendation without changing the lead.
 */
export function deriveNextLeadAction(
  input: DeriveNextLeadActionInput
): NextLeadAction {
  const now = input.now ?? new Date();
  const pendingFollowUps = input.pendingFollowUps ?? [];
  const hasResidualFollowUp = pendingFollowUps.length > 0;

  if (input.hasBlockingGovernance) {
    return { kind: "complete_governance", hasResidualFollowUp };
  }
  if (input.isTerminal) {
    // A pending follow-up on a terminal lead is a residual inconsistency, not
    // a reason to recommend continued commercial work.
    return { kind: "lead_terminal", hasResidualFollowUp };
  }

  const day = partnerDayBounds(input.timeZone, now);
  if (pendingFollowUps.some(followUp => followUp.dueAt < day.start)) {
    return { kind: "complete_overdue_follow_up", hasResidualFollowUp };
  }
  if (
    pendingFollowUps.some(
      followUp => followUp.dueAt >= day.start && followUp.dueAt < day.end
    )
  ) {
    return { kind: "complete_today_follow_up", hasResidualFollowUp };
  }

  const attempts = input.attempts ?? [];
  if (!attempts.length && !input.hasEffectiveContact) {
    return { kind: "make_first_contact_attempt", hasResidualFollowUp: false };
  }

  const latest = latestAttempt(attempts);
  const category = latest?.category.trim().toLowerCase();
  if (category === "awaiting_response") {
    return { kind: "await_response", hasResidualFollowUp: false };
  }
  if (category === "invalid_contact") {
    return { kind: "resolve_invalid_contact", hasResidualFollowUp: false };
  }
  return { kind: "continue_lead_work", hasResidualFollowUp: false };
}
