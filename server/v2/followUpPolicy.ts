import type { CampaignStatus, FollowUpStatus } from "../../drizzle-v2/schema";

export function campaignAllowsNewFollowUp(
  status: CampaignStatus,
  isFrozen: boolean
) {
  return status === "active" && !isFrozen;
}

/** `overdue` is deliberately derived; it is never a persisted follow-up state. */
export function derivedFollowUpStatus(
  status: FollowUpStatus,
  dueAt: Date,
  now: Date
) {
  return status === "pending" && dueAt < now ? "overdue" : status;
}

export function nextPendingDueAt(
  values: readonly { status: FollowUpStatus; dueAt: Date }[]
) {
  const pending = values.filter(value => value.status === "pending");
  if (!pending.length) return null;
  return pending.reduce(
    (earliest, value) => (value.dueAt < earliest ? value.dueAt : earliest),
    pending[0].dueAt
  );
}

export function canTransitionFollowUp(
  current: FollowUpStatus,
  target: "completed" | "cancelled"
) {
  return current === target || current === "pending";
}
