import { and, asc, eq } from "drizzle-orm";
import { pdvs, userPdvAssignments } from "../../drizzle-v2/schema";
import { assertPartnerOwnership, type PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import { canAccessOperationalPdv, requirePdvAdministration } from "./operationalScope";
import { writeV2Audit } from "./partnerService";

function normalizePdvCode(code: string) {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!normalized) throw new Error("Código do PDV inválido");
  return normalized;
}

export type PdvInput = {
  code: string;
  name: string;
  city?: string | null;
  region?: string | null;
};

function normalizedText(value: string | null | undefined) {
  return value?.trim() || null;
}

export async function createPdv(context: PartnerContext, input: PdvInput) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const values = {
    partnerId: context.partnerId,
    code: normalizePdvCode(input.code),
    name: input.name.trim(),
    city: normalizedText(input.city),
    region: normalizedText(input.region),
  };
  if (!values.name) throw new Error("Nome do PDV é obrigatório");

  return db.transaction(async tx => {
    const inserted = await tx.insert(pdvs).values(values);
    const pdvId = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId);
    if (!pdvId) throw new Error("Não foi possível criar o PDV");
    await writeV2Audit(tx as unknown as V2Database, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "pdv_created",
      entityType: "pdv",
      entityId: pdvId,
      metadata: { code: values.code, name: values.name },
    });
    return pdvId;
  });
}

async function getPartnerPdv(db: V2Database, context: PartnerContext, pdvId: number) {
  const pdv = (
    await db.select().from(pdvs).where(and(eq(pdvs.id, pdvId), eq(pdvs.partnerId, context.partnerId))).limit(1)
  )[0];
  if (!pdv) throw new Error("PDV não encontrado");
  assertPartnerOwnership(pdv.partnerId, context);
  return pdv;
}

/** Ensures a PDV ID is not usable outside the active tenant and active scope. */
export async function getAccessiblePdv(context: PartnerContext, pdvId: number) {
  const db = await getV2Db();
  const pdv = await getPartnerPdv(db, context, pdvId);
  if (context.role === "super_admin" || context.role === "partner_admin") return pdv;

  const assignment = (
    await db
      .select({ id: userPdvAssignments.id })
      .from(userPdvAssignments)
      .where(
        and(
          eq(userPdvAssignments.partnerId, context.partnerId),
          eq(userPdvAssignments.membershipId, context.membershipId!),
          eq(userPdvAssignments.pdvId, pdvId),
          eq(userPdvAssignments.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!canAccessOperationalPdv(context, {
    pdvPartnerId: pdv.partnerId,
    pdvIsActive: pdv.isActive,
    assignment: assignment ? { membershipId: context.membershipId!, isActive: true } : null,
  })) throw new Error("PDV não encontrado");
  return pdv;
}

export async function listAccessiblePdvs(context: PartnerContext, includeInactive = false) {
  const db = await getV2Db();
  if (context.role === "super_admin" || context.role === "partner_admin") {
    const filters = [eq(pdvs.partnerId, context.partnerId)];
    if (!includeInactive) filters.push(eq(pdvs.isActive, true));
    return db.select().from(pdvs).where(and(...filters)).orderBy(asc(pdvs.name));
  }

  return db
    .select({
      id: pdvs.id,
      partnerId: pdvs.partnerId,
      code: pdvs.code,
      name: pdvs.name,
      city: pdvs.city,
      region: pdvs.region,
      isActive: pdvs.isActive,
      createdAt: pdvs.createdAt,
      updatedAt: pdvs.updatedAt,
    })
    .from(userPdvAssignments)
    .innerJoin(pdvs, eq(pdvs.id, userPdvAssignments.pdvId))
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId!),
        eq(userPdvAssignments.isActive, true),
        eq(pdvs.isActive, true)
      )
    )
    .orderBy(asc(pdvs.name));
}

export async function updatePdv(context: PartnerContext, pdvId: number, input: PdvInput) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const current = await getPartnerPdv(db, context, pdvId);
  const values = {
    code: normalizePdvCode(input.code),
    name: input.name.trim(),
    city: normalizedText(input.city),
    region: normalizedText(input.region),
    updatedAt: new Date(),
  };
  if (!values.name) throw new Error("Nome do PDV é obrigatório");
  await db.transaction(async tx => {
    await tx.update(pdvs).set(values).where(and(eq(pdvs.id, pdvId), eq(pdvs.partnerId, context.partnerId)));
    await writeV2Audit(tx as unknown as V2Database, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "pdv_updated",
      entityType: "pdv",
      entityId: pdvId,
      metadata: { previousCode: current.code, code: values.code, name: values.name },
    });
  });
}

export async function setPdvActive(context: PartnerContext, pdvId: number, isActive: boolean) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  await getPartnerPdv(db, context, pdvId);
  await db.transaction(async tx => {
    await tx.update(pdvs).set({ isActive, updatedAt: new Date() }).where(and(eq(pdvs.id, pdvId), eq(pdvs.partnerId, context.partnerId)));
    await writeV2Audit(tx as unknown as V2Database, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: isActive ? "pdv_activated" : "pdv_deactivated",
      entityType: "pdv",
      entityId: pdvId,
    });
  });
}
