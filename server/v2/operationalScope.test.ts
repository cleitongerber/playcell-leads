import { describe, expect, it } from "vitest";
import { PartnerAccessError, type PartnerContext } from "./access";
import { canAccessOperationalPdv, requireMembershipPdvTenant, requirePdvAdministration } from "./operationalScope";

const adminA: PartnerContext = { userId: 1, partnerId: 10, membershipId: 101, role: "partner_admin" };
const managerA: PartnerContext = { userId: 2, partnerId: 10, membershipId: 102, role: "manager" };
const sellerA: PartnerContext = { userId: 3, partnerId: 10, membershipId: 103, role: "seller" };

describe("V2 operational PDV scope", () => {
  it("allows the same PDV code in different partners at the tenancy boundary", () => {
    expect(() => requireMembershipPdvTenant(adminA, 10, 10)).not.toThrow();
    expect(() => requireMembershipPdvTenant({ ...adminA, partnerId: 20 }, 20, 20)).not.toThrow();
  });

  it("does not allow a membership from Partner A to receive a PDV from Partner B", () => {
    expect(() => requireMembershipPdvTenant(adminA, 10, 20)).toThrow(PartnerAccessError);
  });

  it("restricts Manager and Seller to their own active assignments", () => {
    expect(canAccessOperationalPdv(managerA, { pdvPartnerId: 10, pdvIsActive: true, assignment: { membershipId: 102, isActive: true } })).toBe(true);
    expect(canAccessOperationalPdv(managerA, { pdvPartnerId: 10, pdvIsActive: true, assignment: { membershipId: 103, isActive: true } })).toBe(false);
    expect(canAccessOperationalPdv(sellerA, { pdvPartnerId: 10, pdvIsActive: true, assignment: { membershipId: 103, isActive: true } })).toBe(true);
  });

  it("removes operational access when an assignment is inactive and restores it when reactivated", () => {
    expect(canAccessOperationalPdv(sellerA, { pdvPartnerId: 10, pdvIsActive: true, assignment: { membershipId: 103, isActive: false } })).toBe(false);
    expect(canAccessOperationalPdv(sellerA, { pdvPartnerId: 10, pdvIsActive: true, assignment: { membershipId: 103, isActive: true } })).toBe(true);
  });

  it("denies IDOR attempts before resource data can be used", () => {
    expect(() => canAccessOperationalPdv(sellerA, { pdvPartnerId: 20, pdvIsActive: true, assignment: { membershipId: 103, isActive: true } })).toThrow(PartnerAccessError);
  });

  it("keeps PDV administration with Partner Admin or Super Admin", () => {
    expect(() => requirePdvAdministration(adminA)).not.toThrow();
    expect(() => requirePdvAdministration(managerA)).toThrow(PartnerAccessError);
    expect(() => requirePdvAdministration(sellerA)).toThrow(PartnerAccessError);
  });
});
