import { assertPartnerOwnership, PartnerAccessError, requirePartnerRole, type PartnerContext } from "./access";

export function requirePdvAdministration(context: PartnerContext) {
  return requirePartnerRole(context, ["super_admin", "partner_admin"]);
}

/** Validates the tenant invariant before an assignment is written. */
export function requireMembershipPdvTenant(
  context: PartnerContext,
  membershipPartnerId: number,
  pdvPartnerId: number
) {
  assertPartnerOwnership(membershipPartnerId, context);
  assertPartnerOwnership(pdvPartnerId, context);
  if (membershipPartnerId !== pdvPartnerId) throw new PartnerAccessError("MEMBERSHIP_NOT_FOUND");
}

export function canAccessOperationalPdv(
  context: PartnerContext,
  input: { pdvPartnerId: number; pdvIsActive: boolean; assignment?: { membershipId: number; isActive: boolean } | null }
) {
  assertPartnerOwnership(input.pdvPartnerId, context);
  if (!input.pdvIsActive) return false;
  if (context.role === "super_admin" || context.role === "partner_admin") return true;
  return input.assignment?.membershipId === context.membershipId && input.assignment.isActive === true;
}
