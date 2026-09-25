import type { PartnerRole } from "./access";

export const distributionOperationType = [
  "assign",
  "reassign",
  "return_to_queue",
  "balanced",
] as const;

export type DistributionOperationType =
  (typeof distributionOperationType)[number];

export type DistributionSkipCode =
  | "already_assigned"
  | "unassigned"
  | "same_owner"
  | "pending_follow_up"
  | "pending_governance"
  | "no_eligible_seller"
  | "seller_not_eligible"
  | "changed_concurrently"
  | "not_visible_or_not_found";

export type DistributionCandidate = {
  id: number;
  pdvId: number;
  assignedMembershipId: number | null;
  receivedAt: Date;
};

export type EligibleSeller = {
  membershipId: number;
  pdvIds: readonly number[];
  activeLeadCount: number;
};

export type BalancedAssignment = {
  leadId: number;
  membershipId: number;
};

export type BalancedPlan = {
  assignments: BalancedAssignment[];
  skipped: Array<{ leadId: number; code: DistributionSkipCode }>;
  resultingLoads: Map<number, number>;
};

/** Distribution is an administrative operation; seller claim remains separate. */
export function canAdministrateDistribution(role: PartnerRole) {
  return role === "super_admin" || role === "partner_admin" || role === "manager";
}

export function defaultDistributionReason(type: DistributionOperationType) {
  switch (type) {
    case "assign":
      return "Distribuição manual";
    case "reassign":
      return "Redistribuição administrativa";
    case "return_to_queue":
      return "Devolução à fila";
    case "balanced":
      return "Distribuição equilibrada";
  }
}

export function normalizeDistributionReason(
  type: DistributionOperationType,
  value?: string | null
) {
  return value?.trim() || defaultDistributionReason(type);
}

/**
 * This only models the expected owner before the SQL compare-and-set. The
 * database update is still conditional so a concurrent actor can win safely.
 */
export function ownerTransitionEligibility(
  type: DistributionOperationType,
  currentMembershipId: number | null,
  nextMembershipId?: number | null
): DistributionSkipCode | null {
  if (type === "assign" || type === "balanced") {
    return currentMembershipId === null ? null : "already_assigned";
  }
  if (type === "reassign") {
    if (currentMembershipId === null) return "unassigned";
    if (currentMembershipId === nextMembershipId) return "same_owner";
    return null;
  }
  return currentMembershipId === null ? "unassigned" : null;
}

/**
 * Queue return deliberately refuses open work. Pending follow-ups and
 * unfinished governance remain attached to the current owner until the
 * manager resolves them or transfers the lead to another seller.
 */
export function queueReturnEligibility(input: {
  hasPendingFollowUp: boolean;
  hasPendingGovernance: boolean;
}): DistributionSkipCode | null {
  if (input.hasPendingFollowUp) return "pending_follow_up";
  if (input.hasPendingGovernance) return "pending_governance";
  return null;
}

/**
 * Deterministic least-loaded round-robin. Leads are ordered by PDV, entry
 * date, then id. For each lead, only sellers scoped to that PDV participate;
 * the seller with the smallest current active portfolio wins, breaking ties by
 * membership id. Every assignment increments the in-memory load immediately.
 */
export function planBalancedDistribution(
  candidates: readonly DistributionCandidate[],
  sellers: readonly EligibleSeller[]
): BalancedPlan {
  const loads = new Map(
    sellers.map(seller => [seller.membershipId, seller.activeLeadCount])
  );
  const sellersByPdv = new Map<number, EligibleSeller[]>();
  for (const seller of sellers) {
    for (const pdvId of seller.pdvIds) {
      const list = sellersByPdv.get(pdvId) ?? [];
      list.push(seller);
      sellersByPdv.set(pdvId, list);
    }
  }

  const assignments: BalancedAssignment[] = [];
  const skipped: BalancedPlan["skipped"] = [];
  const ordered = [...candidates].sort(
    (left, right) =>
      left.pdvId - right.pdvId ||
      left.receivedAt.getTime() - right.receivedAt.getTime() ||
      left.id - right.id
  );

  for (const lead of ordered) {
    const state = ownerTransitionEligibility(
      "balanced",
      lead.assignedMembershipId
    );
    if (state) {
      skipped.push({ leadId: lead.id, code: state });
      continue;
    }
    const eligible = sellersByPdv.get(lead.pdvId) ?? [];
    if (!eligible.length) {
      skipped.push({ leadId: lead.id, code: "no_eligible_seller" });
      continue;
    }
    const selected = [...eligible].sort(
      (left, right) =>
        (loads.get(left.membershipId) ?? 0) -
          (loads.get(right.membershipId) ?? 0) ||
        left.membershipId - right.membershipId
    )[0];
    assignments.push({ leadId: lead.id, membershipId: selected.membershipId });
    loads.set(selected.membershipId, (loads.get(selected.membershipId) ?? 0) + 1);
  }

  return { assignments, skipped, resultingLoads: loads };
}

export function distributionSkipMessage(code: DistributionSkipCode) {
  const messages: Record<DistributionSkipCode, string> = {
    already_assigned: "Lead já possui responsável",
    unassigned: "Lead não possui responsável",
    same_owner: "Lead já está com este vendedor",
    pending_follow_up: "Lead possui follow-up pendente",
    pending_governance: "Lead possui pendência de governança",
    no_eligible_seller: "Nenhum vendedor elegível para o PDV",
    seller_not_eligible: "Vendedor sem acesso ao PDV do lead",
    changed_concurrently: "Lead foi alterado por outra operação",
    not_visible_or_not_found: "Lead indisponível no escopo atual",
  };
  return messages[code];
}
