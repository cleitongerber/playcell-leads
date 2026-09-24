import { and, asc, eq } from "drizzle-orm";
import {
  auditLogs,
  partnerGovernanceRules,
  partnerImportPolicies,
  partners,
  partnerSettings,
  type MembershipRole,
  userPartners,
  users,
} from "../../drizzle-v2/schema";
import { assertPartnerOwnership, type PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import { seedPartnerLeadConfiguration } from "./leadConfiguration";

function normalizeCode(code: string) {
  const normalized = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) throw new Error("Código do parceiro inválido");
  return normalized;
}

function assertGlobalSuperAdmin(context: { userId: number; role?: string }) {
  if (context.role !== "super_admin")
    throw new Error("Apenas Super Admin pode executar esta ação");
}

export function requirePartnerAdministrator(
  context: PartnerContext,
  targetPartnerId: number,
  targetRole?: MembershipRole
) {
  assertPartnerOwnership(targetPartnerId, context);
  if (context.role === "super_admin") return;
  if (context.role !== "partner_admin")
    throw new Error("Apenas Partner Admin pode administrar este parceiro");
  if (targetRole === "partner_admin")
    throw new Error("Somente Super Admin pode atribuir Partner Admin");
}

export async function writeV2Audit(
  db: V2Database,
  input: {
    partnerId?: number | null;
    actorUserId: number;
    actorMembershipId?: number | null;
    action: string;
    entityType: string;
    entityId?: string | number | null;
    metadata?: Record<string, unknown>;
  }
) {
  await db.insert(auditLogs).values({
    partnerId: input.partnerId ?? null,
    actorUserId: input.actorUserId,
    actorMembershipId: input.actorMembershipId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId == null ? null : String(input.entityId),
    metadata: input.metadata ?? null,
  });
}

export async function createPartner(
  actor: { userId: number; role: "super_admin" },
  input: { code: string; name: string }
) {
  assertGlobalSuperAdmin(actor);
  const db = await getV2Db();
  const code = normalizeCode(input.code);

  return db.transaction(async tx => {
    const inserted = await tx
      .insert(partners)
      .values({ code, name: input.name.trim() });
    const partnerId = Number(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId
    );
    if (!partnerId) throw new Error("Não foi possível criar o parceiro");
    await tx.insert(partnerSettings).values({ partnerId });
    await tx.insert(partnerGovernanceRules).values({ partnerId });
    await tx.insert(partnerImportPolicies).values({ partnerId });
    await seedPartnerLeadConfiguration(tx as unknown as V2Database, partnerId);
    await writeV2Audit(tx as unknown as V2Database, {
      actorUserId: actor.userId,
      action: "partner_created",
      entityType: "partner",
      entityId: partnerId,
      metadata: { code },
    });
    return partnerId;
  });
}

export async function listPartners(
  actor: { userId: number; systemRole: "none" | "super_admin" },
  context?: PartnerContext
) {
  const db = await getV2Db();
  if (actor.systemRole === "super_admin")
    return db.select().from(partners).orderBy(asc(partners.name));
  if (!context) throw new Error("Contexto de parceiro obrigatório");
  return db.select().from(partners).where(eq(partners.id, context.partnerId));
}

/**
 * Lists only partners a signed-in user can select in the V2 shell. Unlike a
 * PartnerContext request, this is intentionally usable before a tenant is
 * selected; it is never an authorization grant for operational data.
 */
export async function listSelectablePartners(actor: {
  userId: number;
  systemRole: "none" | "super_admin";
}) {
  const db = await getV2Db();
  if (actor.systemRole === "super_admin") {
    return db
      .select({
        id: partners.id,
        code: partners.code,
        name: partners.name,
        isActive: partners.isActive,
      })
      .from(partners)
      .orderBy(asc(partners.name));
  }

  return db
    .select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      isActive: partners.isActive,
    })
    .from(userPartners)
    .innerJoin(partners, eq(partners.id, userPartners.partnerId))
    .where(
      and(
        eq(userPartners.userId, actor.userId),
        eq(userPartners.isActive, true)
      )
    )
    .orderBy(asc(partners.name));
}

export async function setPartnerActive(
  actor: { userId: number; role: "super_admin" },
  partnerId: number,
  isActive: boolean
) {
  assertGlobalSuperAdmin(actor);
  const db = await getV2Db();
  await db.update(partners).set({ isActive }).where(eq(partners.id, partnerId));
  await writeV2Audit(db, {
    actorUserId: actor.userId,
    action: isActive ? "partner_activated" : "partner_deactivated",
    entityType: "partner",
    entityId: partnerId,
  });
}

export async function createOrUpdateMembership(
  actor: PartnerContext,
  input: {
    partnerId: number;
    userId: number;
    role: MembershipRole;
    isActive: boolean;
  }
) {
  requirePartnerAdministrator(actor, input.partnerId, input.role);
  const db = await getV2Db();
  const targetUser = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!targetUser[0]) throw new Error("Usuário não encontrado");
  if (!targetUser[0].isActive && input.isActive)
    throw new Error("Não é possível ativar membership de usuário inativo");

  await db
    .insert(userPartners)
    .values(input)
    .onDuplicateKeyUpdate({
      set: {
        role: input.role,
        isActive: input.isActive,
        updatedAt: new Date(),
      },
    });
  await writeV2Audit(db, {
    partnerId: input.partnerId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    action: "partner_membership_updated",
    entityType: "user_partner",
    entityId: `${input.userId}:${input.partnerId}`,
    metadata: {
      userId: input.userId,
      role: input.role,
      isActive: input.isActive,
    },
  });
}

export async function listPartnerMemberships(context: PartnerContext) {
  const db = await getV2Db();
  requirePartnerAdministrator(context, context.partnerId);
  return db
    .select({
      id: userPartners.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      userIsActive: users.isActive,
      role: userPartners.role,
      membershipIsActive: userPartners.isActive,
    })
    .from(userPartners)
    .innerJoin(users, eq(users.id, userPartners.userId))
    .where(and(eq(userPartners.partnerId, context.partnerId)))
    .orderBy(asc(users.name));
}
