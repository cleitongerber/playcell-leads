import { and, eq } from "drizzle-orm";
import { partners, type MembershipRole, type SystemRole, type V2Partner, type V2User, type V2UserPartner, userPartners } from "../../drizzle-v2/schema";
import type { V2Database } from "./database";

export type PartnerRole = MembershipRole | "super_admin";

export type PartnerContext = {
  partnerId: number;
  membershipId: number | null;
  role: PartnerRole;
  userId: number;
};

export class PartnerAccessError extends Error {
  constructor(
    public readonly reason:
      | "UNAUTHENTICATED"
      | "USER_INACTIVE"
      | "PARTNER_SELECTION_REQUIRED"
      | "PARTNER_NOT_FOUND"
      | "PARTNER_INACTIVE"
      | "MEMBERSHIP_NOT_FOUND"
      | "MEMBERSHIP_INACTIVE"
      | "ROLE_FORBIDDEN"
  ) {
    super(reason);
  }
}

export type PartnerAccessRepository = {
  getPartner(partnerId: number): Promise<Pick<V2Partner, "id" | "isActive"> | undefined>;
  getMembership(userId: number, partnerId: number): Promise<Pick<V2UserPartner, "id" | "role" | "isActive"> | undefined>;
};

export function createPartnerAccessRepository(db: V2Database): PartnerAccessRepository {
  return {
    async getPartner(partnerId) {
      return (
        await db
          .select({ id: partners.id, isActive: partners.isActive })
          .from(partners)
          .where(eq(partners.id, partnerId))
          .limit(1)
      )[0];
    },
    async getMembership(userId, partnerId) {
      return (
        await db
          .select({ id: userPartners.id, role: userPartners.role, isActive: userPartners.isActive })
          .from(userPartners)
          .where(and(eq(userPartners.userId, userId), eq(userPartners.partnerId, partnerId)))
          .limit(1)
      )[0];
    },
  };
}

export async function resolvePartnerContext(
  user: Pick<V2User, "id" | "isActive" | "systemRole"> | null,
  requestedPartnerId: number | null,
  repository: PartnerAccessRepository
): Promise<PartnerContext> {
  if (!user) throw new PartnerAccessError("UNAUTHENTICATED");
  if (!user.isActive) throw new PartnerAccessError("USER_INACTIVE");
  if (!requestedPartnerId) throw new PartnerAccessError("PARTNER_SELECTION_REQUIRED");

  const partner = await repository.getPartner(requestedPartnerId);
  if (!partner) throw new PartnerAccessError("PARTNER_NOT_FOUND");
  if (!partner.isActive) throw new PartnerAccessError("PARTNER_INACTIVE");

  if (user.systemRole === "super_admin") {
    return { partnerId: partner.id, membershipId: null, role: "super_admin", userId: user.id };
  }

  const membership = await repository.getMembership(user.id, partner.id);
  if (!membership) throw new PartnerAccessError("MEMBERSHIP_NOT_FOUND");
  if (!membership.isActive) throw new PartnerAccessError("MEMBERSHIP_INACTIVE");

  return {
    partnerId: partner.id,
    membershipId: membership.id,
    role: membership.role,
    userId: user.id,
  };
}

export function requirePartnerRole(context: PartnerContext, allowedRoles: readonly PartnerRole[]) {
  if (!allowedRoles.includes(context.role)) throw new PartnerAccessError("ROLE_FORBIDDEN");
  return context;
}

/** Stops IDOR: an entity loaded for a different tenant can never be reused. */
export function assertPartnerOwnership(entityPartnerId: number, context: PartnerContext) {
  if (entityPartnerId !== context.partnerId) throw new PartnerAccessError("MEMBERSHIP_NOT_FOUND");
}

export function isSuperAdmin(systemRole: SystemRole) {
  return systemRole === "super_admin";
}
