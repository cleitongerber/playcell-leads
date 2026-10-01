import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { createHash } from "crypto";
import { partners, pdvs, userPartners, userPdvAssignments, users } from "../../drizzle-v2/schema";
import { getV2Db, type V2Database } from "./database";
import { hashV2Password } from "./password";
import { writeV2Audit } from "./partnerService";

export type ManagementPartnerScope = {
  partnerId: number;
  isActive: boolean;
  pdvScopeMode: "all" | "specific";
  pdvIds: number[];
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function localOpenId(email: string) {
  return `local:${createHash("sha256").update(email).digest("hex")}`;
}

function normalizeScopes(scopes: ManagementPartnerScope[]) {
  const byPartner = new Map<number, ManagementPartnerScope>();
  for (const scope of scopes) {
    if (byPartner.has(scope.partnerId)) throw new Error("Parceiro repetido no escopo Gestão");
    if (scope.pdvScopeMode === "specific" && !scope.pdvIds.length)
      throw new Error("Selecione ao menos um PDV para o escopo específico");
    byPartner.set(scope.partnerId, {
      ...scope,
      pdvIds: Array.from(new Set(scope.pdvIds)),
    });
  }
  if (!byPartner.size) throw new Error("Selecione ao menos um parceiro para Gestão");
  return Array.from(byPartner.values());
}

async function validatePartnerScope(db: V2Database, scope: ManagementPartnerScope) {
  const partner = (await db.select({ id: partners.id, isActive: partners.isActive }).from(partners).where(eq(partners.id, scope.partnerId)).limit(1))[0];
  if (!partner?.isActive) throw new Error("Parceiro indisponível para acesso Gestão");
  if (scope.pdvScopeMode === "all") return;
  const rows = await db.select({ id: pdvs.id }).from(pdvs).where(
    and(eq(pdvs.partnerId, scope.partnerId), eq(pdvs.isActive, true), inArray(pdvs.id, scope.pdvIds))
  );
  if (rows.length !== scope.pdvIds.length)
    throw new Error("Um ou mais PDVs não pertencem ao parceiro ou estão inativos");
}

async function replaceManagementScope(
  db: V2Database,
  actorUserId: number,
  userId: number,
  scope: ManagementPartnerScope
) {
  await validatePartnerScope(db, scope);
  const previous = (await db.select().from(userPartners).where(and(eq(userPartners.userId, userId), eq(userPartners.partnerId, scope.partnerId))).limit(1))[0];
  await db.insert(userPartners).values({
    userId,
    partnerId: scope.partnerId,
    role: "management",
    isActive: scope.isActive,
    pdvScopeMode: scope.pdvScopeMode,
  }).onDuplicateKeyUpdate({ set: { role: "management", isActive: scope.isActive, pdvScopeMode: scope.pdvScopeMode, updatedAt: new Date() } });
  const membership = (await db.select().from(userPartners).where(and(eq(userPartners.userId, userId), eq(userPartners.partnerId, scope.partnerId))).limit(1))[0];
  if (!membership) throw new Error("Não foi possível configurar o acesso Gestão");

  const existing = await db.select({ pdvId: userPdvAssignments.pdvId, isActive: userPdvAssignments.isActive }).from(userPdvAssignments).where(and(eq(userPdvAssignments.partnerId, scope.partnerId), eq(userPdvAssignments.membershipId, membership.id)));
  const desired = scope.pdvScopeMode === "specific" ? new Set(scope.pdvIds) : new Set<number>();
  for (const assignment of existing) {
    if (assignment.isActive && !desired.has(assignment.pdvId)) {
      await db.update(userPdvAssignments).set({ isActive: false, updatedAt: new Date() }).where(and(eq(userPdvAssignments.membershipId, membership.id), eq(userPdvAssignments.pdvId, assignment.pdvId)));
      await writeV2Audit(db, { partnerId: scope.partnerId, actorUserId, action: "management_pdv_removed", entityType: "user_pdv_assignment", entityId: `${membership.id}:${assignment.pdvId}`, metadata: { targetUserId: userId, pdvId: assignment.pdvId } });
    }
  }
  if (scope.pdvScopeMode === "specific") {
    for (const pdvId of Array.from(desired)) {
      const was = existing.find(item => item.pdvId === pdvId);
      await db.insert(userPdvAssignments).values({ partnerId: scope.partnerId, membershipId: membership.id, pdvId, isActive: true }).onDuplicateKeyUpdate({ set: { isActive: true, updatedAt: new Date() } });
      if (!was?.isActive) await writeV2Audit(db, { partnerId: scope.partnerId, actorUserId, action: "management_pdv_granted", entityType: "user_pdv_assignment", entityId: `${membership.id}:${pdvId}`, metadata: { targetUserId: userId, pdvId } });
    }
  }
  await writeV2Audit(db, {
    partnerId: scope.partnerId,
    actorUserId,
    action: previous ? "management_partner_scope_updated" : "management_partner_granted",
    entityType: "user_partner",
    entityId: membership.id,
    metadata: { targetUserId: userId, pdvScopeMode: scope.pdvScopeMode, isActive: scope.isActive },
  });
}

export async function createManagementUser(
  actorUserId: number,
  input: { name: string; email: string; password: string; scopes: ManagementPartnerScope[] }
) {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) throw new Error("Nome é obrigatório");
  if (input.password.length < 8) throw new Error("A senha inicial deve ter no mínimo 8 caracteres");
  const scopes = normalizeScopes(input.scopes);
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    let user = (await transactionDb.select().from(users).where(eq(users.email, email)).limit(1))[0];
    const created = !user;
    if (!user) {
      const inserted = await tx.insert(users).values({ openId: localOpenId(email), email, name, passwordHash: await hashV2Password(input.password), mustChangePassword: true, loginMethod: "password" });
      const userId = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId);
      user = (await transactionDb.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    }
    if (!user || !user.isActive) throw new Error("Usuário indisponível para acesso Gestão");
    for (const scope of scopes) await replaceManagementScope(transactionDb, actorUserId, user.id, scope);
    await writeV2Audit(transactionDb, { actorUserId, action: created ? "management_user_created" : "management_user_linked", entityType: "user", entityId: user.id, metadata: { scopeCount: scopes.length } });
    return { userId: user.id };
  });
}

export async function listManagementUsers() {
  const db = await getV2Db();
  const rows = await db.select({ userId: users.id, name: users.name, email: users.email, isActive: users.isActive, mustChangePassword: users.mustChangePassword, membershipId: userPartners.id, partnerId: userPartners.partnerId, partnerName: partners.name, membershipIsActive: userPartners.isActive, pdvScopeMode: userPartners.pdvScopeMode, pdvId: userPdvAssignments.pdvId, pdvName: pdvs.name, pdvAssignmentIsActive: userPdvAssignments.isActive }).from(userPartners).innerJoin(users, eq(users.id, userPartners.userId)).innerJoin(partners, eq(partners.id, userPartners.partnerId)).leftJoin(userPdvAssignments, eq(userPdvAssignments.membershipId, userPartners.id)).leftJoin(pdvs, eq(pdvs.id, userPdvAssignments.pdvId)).where(eq(userPartners.role, "management")).orderBy(asc(users.name));
  const grouped = new Map<number, any>();
  for (const row of rows) {
    let user = grouped.get(row.userId);
    if (!user) { user = { userId: row.userId, name: row.name, email: row.email, isActive: row.isActive, mustChangePassword: row.mustChangePassword, scopes: [] as any[] }; grouped.set(row.userId, user); }
    let scope = user.scopes.find((item: any) => item.membershipId === row.membershipId);
    if (!scope) { scope = { membershipId: row.membershipId, partnerId: row.partnerId, partnerName: row.partnerName, isActive: row.membershipIsActive, pdvScopeMode: row.pdvScopeMode, pdvIds: [] as number[] }; user.scopes.push(scope); }
    if (row.pdvId && row.pdvAssignmentIsActive) scope.pdvIds.push(row.pdvId);
  }
  return Array.from(grouped.values());
}

export async function listManagementPartnerPdvs(partnerId: number) {
  const db = await getV2Db();
  return db.select({ id: pdvs.id, name: pdvs.name, code: pdvs.code }).from(pdvs).where(and(eq(pdvs.partnerId, partnerId), eq(pdvs.isActive, true))).orderBy(asc(pdvs.name));
}

export async function updateManagementUser(
  actorUserId: number,
  input: { userId: number; name: string; email: string; isActive: boolean; scopes: ManagementPartnerScope[] }
) {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) throw new Error("Nome é obrigatório");
  const scopes = normalizeScopes(input.scopes);
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const user = (await transactionDb.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
    if (!user) throw new Error("Usuário não encontrado");
    const duplicate = (await transactionDb.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, input.userId))).limit(1))[0];
    if (duplicate) throw new Error("Já existe um usuário com este e-mail");
    await tx.update(users).set({ name, email, isActive: input.isActive, updatedAt: new Date() }).where(eq(users.id, input.userId));
    const existing = await transactionDb.select().from(userPartners).where(and(eq(userPartners.userId, input.userId), eq(userPartners.role, "management")));
    const requested = new Set(scopes.map(scope => scope.partnerId));
    for (const membership of existing) {
      if (!requested.has(membership.partnerId) && membership.isActive) {
        await tx.update(userPartners).set({ isActive: false, updatedAt: new Date() }).where(eq(userPartners.id, membership.id));
        await writeV2Audit(transactionDb, { partnerId: membership.partnerId, actorUserId, action: "management_partner_removed", entityType: "user_partner", entityId: membership.id, metadata: { targetUserId: input.userId } });
      }
    }
    for (const scope of scopes) await replaceManagementScope(transactionDb, actorUserId, input.userId, scope);
    await writeV2Audit(transactionDb, { actorUserId, action: "management_user_updated", entityType: "user", entityId: input.userId, metadata: { nameChanged: user.name !== name, emailChanged: user.email !== email, isActive: input.isActive } });
  });
}

export async function resetManagementUserPassword(actorUserId: number, userId: number, password: string) {
  if (password.length < 8) throw new Error("A nova senha deve ter no mínimo 8 caracteres");
  const db = await getV2Db();
  const membership = (await db.select({ id: userPartners.id }).from(userPartners).where(and(eq(userPartners.userId, userId), eq(userPartners.role, "management"))).limit(1))[0];
  if (!membership) throw new Error("Usuário Gestão não encontrado");
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx.update(users).set({ passwordHash: await hashV2Password(password), mustChangePassword: true, updatedAt: new Date() }).where(eq(users.id, userId));
    await writeV2Audit(transactionDb, { actorUserId, action: "management_password_reset", entityType: "user", entityId: userId, metadata: { mustChangePassword: true } });
  });
}
