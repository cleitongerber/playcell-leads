export const portfolioPriorities = [
  "overdue",
  "today",
  "unworked",
  "attempting",
  "in_progress",
  "upcoming",
  "terminal",
] as const;

export type PortfolioPriority = (typeof portfolioPriorities)[number];

export type PortfolioOperationalFilter =
  | "all"
  | "action"
  | "unworked"
  | "returns"
  | "closed";

export type PortfolioPriorityInput = {
  isTerminal: boolean;
  hasAttempt: boolean;
  hasEffectiveContact: boolean;
  nextFollowUpAt: Date | null;
  now: Date;
  dayEnd: Date;
};

/**
 * This is deliberately derived from persisted facts, not stored on the Lead.
 * Terminal status wins over any residual historical follow-up.
 */
export function derivePortfolioPriority(
  input: PortfolioPriorityInput
): PortfolioPriority {
  if (input.isTerminal) return "terminal";

  const dueAt = input.nextFollowUpAt;
  if (dueAt && dueAt < input.now) return "overdue";
  if (dueAt && dueAt < input.dayEnd) return "today";

  // A future return does not hide an untouched Lead: the seller still needs
  // to make the first contact attempt.
  if (!input.hasAttempt && !input.hasEffectiveContact) return "unworked";

  // A scheduled return has precedence over a further unscheduled attempt.
  if (!input.hasEffectiveContact && !dueAt) return "attempting";
  if (dueAt) return "upcoming";
  return "in_progress";
}

export function matchesPortfolioOperationalFilter(
  priority: PortfolioPriority,
  filter: PortfolioOperationalFilter
) {
  switch (filter) {
    case "action":
      return ["overdue", "today", "unworked", "attempting"].includes(priority);
    case "unworked":
      return priority === "unworked";
    case "returns":
      return ["overdue", "today", "upcoming"].includes(priority);
    case "closed":
      return priority === "terminal";
    default:
      return true;
  }
}

export function portfolioPriorityRank(priority: PortfolioPriority) {
  return portfolioPriorities.indexOf(priority) + 1;
}
