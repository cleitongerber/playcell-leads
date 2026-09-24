import { describe, expect, it } from "vitest";
import { assertPartnerOwnership, PartnerAccessError, requirePartnerRole, resolvePartnerContext, type PartnerAccessRepository } from "./access";

const users = {
  super: { id: 1, isActive: true, systemRole: "super_admin" as const },
  adminA: { id: 2, isActive: true, systemRole: "none" as const },
  managerA: { id: 3, isActive: true, systemRole: "none" as const },
  sellerA: { id: 4, isActive: true, systemRole: "none" as const },
  dualRole: { id: 5, isActive: true, systemRole: "none" as const },
  inactive: { id: 6, isActive: false, systemRole: "none" as const },
  membershipInactive: { id: 7, isActive: true, systemRole: "none" as const },
};

const repository: PartnerAccessRepository = {
  async getPartner(id) {
    if (id === 1) return { id, isActive: true };
    if (id === 2) return { id, isActive: true };
    if (id === 3) return { id, isActive: false };
    return undefined;
  },
  async getMembership(userId, partnerId) {
    const rows: Record<string, { id: number; role: "partner_admin" | "manager" | "seller"; isActive: boolean }> = {
      "2:1": { id: 21, role: "partner_admin", isActive: true },
      "3:1": { id: 31, role: "manager", isActive: true },
      "4:1": { id: 41, role: "seller", isActive: true },
      "5:1": { id: 51, role: "seller", isActive: true },
      "5:2": { id: 52, role: "manager", isActive: true },
      "7:1": { id: 71, role: "seller", isActive: false },
    };
    return rows[`${userId}:${partnerId}`];
  },
};

async function expectReason(promise: Promise<unknown>, reason: PartnerAccessError["reason"]) {
  await expect(promise).rejects.toMatchObject({ reason });
}

describe("V2 PartnerContext", () => {
  it("rejects anonymous and inactive users", async () => {
    await expectReason(resolvePartnerContext(null, 1, repository), "UNAUTHENTICATED");
    await expectReason(resolvePartnerContext(users.inactive, 1, repository), "USER_INACTIVE");
  });

  it("requires an explicit active partner selection", async () => {
    await expectReason(resolvePartnerContext(users.adminA, null, repository), "PARTNER_SELECTION_REQUIRED");
    await expectReason(resolvePartnerContext(users.adminA, 3, repository), "PARTNER_INACTIVE");
    await expectReason(resolvePartnerContext(users.adminA, 999, repository), "PARTNER_NOT_FOUND");
  });

  it("resolves Super Admin globally without requiring a membership", async () => {
    await expect(resolvePartnerContext(users.super, 2, repository)).resolves.toEqual({
      partnerId: 2,
      membershipId: null,
      role: "super_admin",
      userId: 1,
    });
  });

  it("resolves Partner Admin, Manager, and Seller roles", async () => {
    await expect(resolvePartnerContext(users.adminA, 1, repository)).resolves.toMatchObject({ role: "partner_admin", membershipId: 21 });
    await expect(resolvePartnerContext(users.managerA, 1, repository)).resolves.toMatchObject({ role: "manager", membershipId: 31 });
    await expect(resolvePartnerContext(users.sellerA, 1, repository)).resolves.toMatchObject({ role: "seller", membershipId: 41 });
  });

  it("keeps roles independent for one user in two partners", async () => {
    await expect(resolvePartnerContext(users.dualRole, 1, repository)).resolves.toMatchObject({ partnerId: 1, role: "seller", membershipId: 51 });
    await expect(resolvePartnerContext(users.dualRole, 2, repository)).resolves.toMatchObject({ partnerId: 2, role: "manager", membershipId: 52 });
  });

  it("rejects inactive and absent memberships", async () => {
    await expectReason(resolvePartnerContext(users.membershipInactive, 1, repository), "MEMBERSHIP_INACTIVE");
    await expectReason(resolvePartnerContext(users.managerA, 2, repository), "MEMBERSHIP_NOT_FOUND");
  });

  it("blocks a Partner Admin from selecting Partner B", async () => {
    await expectReason(resolvePartnerContext(users.adminA, 2, repository), "MEMBERSHIP_NOT_FOUND");
  });

  it("rejects tenant-ID manipulation even when the target ID is valid", async () => {
    const context = await resolvePartnerContext(users.adminA, 1, repository);
    expect(() => assertPartnerOwnership(1, context)).not.toThrow();
    expect(() => assertPartnerOwnership(2, context)).toThrow(PartnerAccessError);
  });

  it("centralizes role checks instead of trusting routes", async () => {
    const seller = await resolvePartnerContext(users.sellerA, 1, repository);
    expect(() => requirePartnerRole(seller, ["seller", "manager", "partner_admin", "super_admin"])).not.toThrow();
    expect(() => requirePartnerRole(seller, ["manager", "partner_admin", "super_admin"])).toThrow(PartnerAccessError);
  });
});
