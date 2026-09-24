import { and, asc, eq, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { pdvs, type MembershipRole, userPartners, userPdvAssignments, users } from "../../drizzle-v2/schema";
import { type PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import { requireMembershipPdvTenant } from "./operationalScope";
import { hashV2Password } from "./password";
import { requirePartnerAdministrator, writeV2Audit } from "./partnerService";

type MembershipInput = {
  role: MembershipRole;
  isActive: boolean;
  pdvIds?: number[];
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function localOpenId(email: string) {
  return `local:${createHash("sha256").update(email).digest("hex")}`;
}

async function getMembershipInPartner(db: V2Database, partnerId: number, membershipId: number) {
  const membership = (
    await db
      .select()
      .from(userPartners)
      .where(and(eq(userPartners.id, membershipId), eq(userPartners.partnerId, partnerId)))
      .limit(1)
  )[0];
  if (!membership) throw new Error("Acesso do usuário não encontrado");
  return membership;
}

async function validatePdvScope(db: V2Database, partnerId: number, pdvIds: number[]) {
  const uniqueIds = Array.from(new Set(pdvIds));
  if (!uniqueIds.length) return uniqueIds;
  const scopedPdvs = await db
    .select({ id: pdvs.id, isActive: pdvs.isActive })
    .from(pdvs)
    .where(and(eq(pdvs.partnerId, partnerId), inArray(pdvs.id, uniqueIds)));
  if (scopedPdvs.length !== uniqueIds.length || scopedPdvs.some(pdv => !pdv.isActive)) {
    throw new Error("Um ou mais PDVs não estão ativos ou não pertencem ao parceiro atual");
  }
  return uniqueIds;
}

async function replacePdvScope(
  db: V2Database,
  context: PartnerContext,
  membershipId: number,
  pdvIds: number[]
) {
  const membership = await getMembershipInPartner(db, context.partnerId, membershipId);
  requireMembershipPdvTenant(context, membership.partnerId, context.partnerId);
  const validIds = await validatePdvScope(db, context.partnerId, pdvIds);
  const current = await db
    .select({ pdvId: userPdvAssignments.pdvId, isActive: userPdvAssignments.isActive })
    .from(userPdvAssignments)
    .where(and(eq(userPdvAssignments.partnerId, context.partnerId), eq(userPdvAssignments.membershipId, membershipId)));
  const wanted = new Set(validIds);

  for (const assignment of current) {
    if (!wanted.has(assignment.pdvId) && assignment.isActive) {
      await db
        .update(userPdvAssignments)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(userPdvAssignments.membershipId, membershipId), eq(userPdvAssignments.pdvId, assignment.pdvId)));
      await writeV2Audit(db, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "membership_pdv_assignment_deactivated",
        entityType: "user_pdv_assignment",
        entityId: `${membershipId}:${assignment.pdvId}`,
        metadata: { membershipId, pdvId: assignment.pdvId },
      });
    }
  }

  for (const pdvId of validIds) {
    const previous = current.find(item => item.pdvId === pdvId);
    await db
      .insert(userPdvAssignments)
      .values({ partnerId: context.partnerId, membershipId, pdvId, isActive: true })
      .onDuplicateKeyUpdate({ set: { isActive: true, updatedAt: new Date() } });
    if (!previous?.isActive) {
      await writeV2Audit(db, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: previous ? "membership_pdv_assignment_reactivated" : "membership_pdv_assignment_created",
        entityType: "user_pdv_assignment",
        entityId: `${membershipId}:${pdvId}`,
        metadata: { membershipId, pdvId },
      });
    }
  }
}

export async function createPartnerUser(
  context: PartnerContext,
  input: { name: string; email: string; password: string; role: MembershipRole; pdvIds: number[] }
) {
  requirePartnerAdministrator(context, context.partnerId, input.role);
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) throw new Error("Nome é obrigatório");
  if (input.password.length < 8) throw new Error("A senha inicial deve ter no mínimo 8 caracteres");
  const db = await getV2Db();

  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    let user = (await transactionDb.select().from(users).where(eq(users.email, email)).limit(1))[0];
    const isNewUser = !user;
    if (!user) {
      const inserted = await tx.insert(users).values({
        openId: localOpenId(email),
        email,
        name,
        passwordHash: await hashV2Password(input.password),
        loginMethod: "password",
      });
      const userId = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId);
      user = (await transactionDb.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    }
    if (!user) throw new Error("Não foi possível criar o usuário");
    if (!user.isActive) throw new Error("O usuário está inativo globalmente e deve ser reativado por um Super Admin");

    const previous = (
      await transactionDb
        .select()
        .from(userPartners)
        .where(and(eq(userPartners.userId, user.id), eq(userPartners.partnerId, context.partnerId)))
        .limit(1)
    )[0];
    await tx
      .insert(userPartners)
      .values({ userId: user.id, partnerId: context.partnerId, role: input.role, isActive: true })
      .onDuplicateKeyUpdate({ set: { role: input.role, isActive: true, updatedAt: new Date() } });
    const membership = (
      await transactionDb
        .select()
        .from(userPartners)
        .where(and(eq(userPartners.userId, user.id), eq(userPartners.partnerId, context.partnerId)))
        .limit(1)
    )[0];
    if (!membership) throw new Error("Não foi possível associar o usuário ao parceiro");
    await replacePdvScope(transactionDb, context, membership.id, input.pdvIds);

    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: isNewUser ? "user_created" : "user_membership_linked",
      entityType: "user",
      entityId: user.id,
      metadata: { membershipId: membership.id },
    });
    if (previous?.role !== input.role) {
      await writeV2Audit(transactionDb, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "membership_role_changed",
        entityType: "user_partner",
        entityId: membership.id,
        metadata: { from: previous?.role ?? null, to: input.role },
      });
    }
    return { userId: user.id, membershipId: membership.id };
  });
}

export async function updatePartnerMembership(
  context: PartnerContext,
  membershipId: number,
  input: MembershipInput
) {
  requirePartnerAdministrator(context, context.partnerId, input.role);
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const membership = await getMembershipInPartner(transactionDb, context.partnerId, membershipId);
    const user = (await transactionDb.select().from(users).where(eq(users.id, membership.userId)).limit(1))[0];
    if (!user) throw new Error("Usuário não encontrado");
    if (input.isActive && !user.isActive) throw new Error("Não é possível reativar acesso de usuário globalmente inativo");

    await tx
      .update(userPartners)
      .set({ role: input.role, isActive: input.isActive, updatedAt: new Date() })
      .where(and(eq(userPartners.id, membershipId), eq(userPartners.partnerId, context.partnerId)));
    if (membership.role !== input.role) {
      await writeV2Audit(transactionDb, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "membership_role_changed",
        entityType: "user_partner",
        entityId: membershipId,
        metadata: { from: membership.role, to: input.role },
      });
    }
    if (membership.isActive !== input.isActive) {
      await writeV2Audit(transactionDb, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: input.isActive ? "membership_activated" : "membership_deactivated",
        entityType: "user_partner",
        entityId: membershipId,
      });
    }
    if (input.pdvIds) await replacePdvScope(transactionDb, context, membershipId, input.pdvIds);
  });
}

export async function setGlobalUserActive(context: PartnerContext, userId: number, isActive: boolean) {
  if (context.role !== "super_admin") throw new Error("Apenas Super Admin pode alterar o status global do usuário");
  const db = await getV2Db();
  const target = (await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!target) throw new Error("Usuário não encontrado");
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, userId));
    await writeV2Audit(transactionDb, {
      actorUserId: context.userId,
      action: isActive ? "user_global_activated" : "user_global_deactivated",
      entityType: "user",
      entityId: userId,
    });
  });
}

export async function listPartnerUsers(context: PartnerContext) {
  requirePartnerAdministrator(context, context.partnerId);
  const db = await getV2Db();
  const rows = await db
    .select({
      membershipId: userPartners.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      userIsActive: users.isActive,
      role: userPartners.role,
      membershipIsActive: userPartners.isActive,
      pdvId: pdvs.id,
      pdvName: pdvs.name,
      assignmentIsActive: userPdvAssignments.isActive,
    })
    .from(userPartners)
    .innerJoin(users, eq(users.id, userPartners.userId))
    .leftJoin(userPdvAssignments, eq(userPdvAssignments.membershipId, userPartners.id))
    .leftJoin(pdvs, eq(pdvs.id, userPdvAssignments.pdvId))
    .where(eq(userPartners.partnerId, context.partnerId))
    .orderBy(asc(users.name));

  const grouped = new Map<number, (typeof rows)[number] & { pdvs: Array<{ id: number; name: string; isActive: boolean }> }>();
  for (const row of rows) {
    let person = grouped.get(row.membershipId);
    if (!person) {
      person = { ...row, pdvs: [] };
      grouped.set(row.membershipId, person);
    }
    if (row.pdvId && row.pdvName) person.pdvs.push({ id: row.pdvId, name: row.pdvName, isActive: row.assignmentIsActive ?? false });
  }
  return Array.from(grouped.values()).map(({ pdvId: _pdvId, pdvName: _pdvName, assignmentIsActive: _assignment, ...person }) => person);
}
