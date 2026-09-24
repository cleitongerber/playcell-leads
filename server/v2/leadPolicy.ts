import type { CampaignStatus } from "../../drizzle-v2/schema";

export function campaignAllowsLeadOperations(
  status: CampaignStatus,
  isFrozen: boolean
) {
  return status === "active" && !isFrozen;
}

export function sellerCanModifyLead(
  assignedMembershipId: number | null,
  membershipId: number | null
) {
  return assignedMembershipId !== null && assignedMembershipId === membershipId;
}

/** Models the compare-and-set rule implemented by the conditional SQL claim. */
export function conditionalClaim(
  currentMembershipId: number | null,
  requestedMembershipId: number
) {
  return currentMembershipId === null
    ? { won: true, assignedMembershipId: requestedMembershipId }
    : { won: false, assignedMembershipId: currentMembershipId };
}
