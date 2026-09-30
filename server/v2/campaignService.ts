import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  campaignPdvs,
  campaignGovernanceOverrides,
  campaignImportPolicies,
  campaigns,
  leadImportBatches,
  leadStatuses,
  leads,
  pdvs,
  type CampaignStatus,
  userPdvAssignments,
} from "../../drizzle-v2/schema";
import { type PartnerContext } from "./access";
import {
  assertCampaignTransition,
  canEditCampaign,
  canFreezeCampaign,
  canViewCampaignByPdvScope,
  normalizeCampaignCode,
} from "./campaignDomain";
import { getV2Db, type V2Database } from "./database";
import { requirePdvAdministration } from "./operationalScope";
import { writeV2Audit } from "./partnerService";

export type CampaignInput = {
  code: string;
  name: string;
  description?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  pdvIds: number[];
};

function cleanText(value: string | null | undefined) {
  return value?.trim() || null;
}

function assertPeriod(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined
) {
  if (startsAt && endsAt && endsAt <= startsAt)
    throw new Error("A data final deve ser posterior à data inicial");
}

async function getCampaignInPartner(
  db: V2Database,
  context: PartnerContext,
  campaignId: number
) {
  const campaign = (
    await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.partnerId, context.partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!campaign) throw new Error("Campanha não encontrada");
  return campaign;
}

async function assertCampaignScope(
  db: V2Database,
  context: PartnerContext,
  campaignId: number
) {
  const campaign = await getCampaignInPartner(db, context, campaignId);
  if (context.role === "super_admin" || context.role === "partner_admin")
    return campaign;
  const campaignScope = await db
    .select({ pdvId: campaignPdvs.pdvId })
    .from(campaignPdvs)
    .innerJoin(pdvs, eq(pdvs.id, campaignPdvs.pdvId))
    .where(
      and(
        eq(campaignPdvs.partnerId, context.partnerId),
        eq(campaignPdvs.campaignId, campaignId),
        eq(campaignPdvs.isActive, true),
        eq(pdvs.isActive, true)
      )
    );
  const assignments = await db
    .select({ pdvId: userPdvAssignments.pdvId })
    .from(userPdvAssignments)
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId!),
        eq(userPdvAssignments.isActive, true)
      )
    );
  if (
    !canViewCampaignByPdvScope(
      context,
      campaign.partnerId,
      campaignScope.map(item => item.pdvId),
      assignments.map(item => item.pdvId)
    )
  )
    throw new Error("Campanha não encontrada");
  return campaign;
}

async function validateCampaignPdvs(
  db: V2Database,
  partnerId: number,
  pdvIds: number[]
) {
  const ids = Array.from(new Set(pdvIds));
  if (!ids.length)
    throw new Error("Selecione ao menos um PDV ativo para a campanha");
  const found = await db
    .select({ id: pdvs.id, isActive: pdvs.isActive })
    .from(pdvs)
    .where(and(eq(pdvs.partnerId, partnerId), inArray(pdvs.id, ids)));
  if (found.length !== ids.length || found.some(pdv => !pdv.isActive)) {
    throw new Error(
      "Um ou mais PDVs não estão ativos ou não pertencem ao parceiro atual"
    );
  }
  return ids;
}

async function replaceCampaignPdvs(
  db: V2Database,
  context: PartnerContext,
  campaignId: number,
  pdvIds: number[]
) {
  const validIds = await validateCampaignPdvs(db, context.partnerId, pdvIds);
  const current = await db
    .select({ pdvId: campaignPdvs.pdvId, isActive: campaignPdvs.isActive })
    .from(campaignPdvs)
    .where(
      and(
        eq(campaignPdvs.partnerId, context.partnerId),
        eq(campaignPdvs.campaignId, campaignId)
      )
    );
  const wanted = new Set(validIds);
  for (const relation of current) {
    if (!wanted.has(relation.pdvId) && relation.isActive) {
      await db
        .update(campaignPdvs)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(campaignPdvs.campaignId, campaignId),
            eq(campaignPdvs.pdvId, relation.pdvId)
          )
        );
      await writeV2Audit(db, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "campaign_pdv_deactivated",
        entityType: "campaign_pdv",
        entityId: `${campaignId}:${relation.pdvId}`,
        metadata: { campaignId, pdvId: relation.pdvId },
      });
    }
  }
  for (const pdvId of validIds) {
    const existing = current.find(relation => relation.pdvId === pdvId);
    await db
      .insert(campaignPdvs)
      .values({
        partnerId: context.partnerId,
        campaignId,
        pdvId,
        isActive: true,
      })
      .onDuplicateKeyUpdate({ set: { isActive: true, updatedAt: new Date() } });
    if (!existing?.isActive) {
      await writeV2Audit(db, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: existing ? "campaign_pdv_reactivated" : "campaign_pdv_created",
        entityType: "campaign_pdv",
        entityId: `${campaignId}:${pdvId}`,
        metadata: { campaignId, pdvId },
      });
    }
  }
}

export async function createCampaign(
  context: PartnerContext,
  input: CampaignInput
) {
  requirePdvAdministration(context);
  assertPeriod(input.startsAt, input.endsAt);
  const db = await getV2Db();
  const values = {
    partnerId: context.partnerId,
    code: normalizeCampaignCode(input.code),
    name: input.name.trim(),
    description: cleanText(input.description),
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
  };
  if (!values.name) throw new Error("Nome da campanha é obrigatório");
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await validateCampaignPdvs(transactionDb, context.partnerId, input.pdvIds);
    const inserted = await tx.insert(campaigns).values(values);
    const campaignId = Number(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId
    );
    if (!campaignId) throw new Error("Não foi possível criar a campanha");
    await replaceCampaignPdvs(transactionDb, context, campaignId, input.pdvIds);
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "campaign_created",
      entityType: "campaign",
      entityId: campaignId,
      metadata: {
        code: values.code,
        pdvIds: Array.from(new Set(input.pdvIds)),
      },
    });
    return campaignId;
  });
}

export async function updateCampaign(
  context: PartnerContext,
  campaignId: number,
  input: CampaignInput
) {
  requirePdvAdministration(context);
  assertPeriod(input.startsAt, input.endsAt);
  const db = await getV2Db();
  const current = await getCampaignInPartner(db, context, campaignId);
  if (!canEditCampaign(current.status))
    throw new Error("Apenas campanhas em rascunho podem ser editadas");
  const values = {
    code: normalizeCampaignCode(input.code),
    name: input.name.trim(),
    description: cleanText(input.description),
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    updatedAt: new Date(),
  };
  if (!values.name) throw new Error("Nome da campanha é obrigatório");
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx
      .update(campaigns)
      .set(values)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.partnerId, context.partnerId)
        )
      );
    await replaceCampaignPdvs(transactionDb, context, campaignId, input.pdvIds);
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "campaign_updated",
      entityType: "campaign",
      entityId: campaignId,
      metadata: { previousCode: current.code, code: values.code },
    });
  });
}

export async function transitionCampaign(
  context: PartnerContext,
  campaignId: number,
  status: CampaignStatus
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const current = await getCampaignInPartner(db, context, campaignId);
  assertCampaignTransition(current.status, status);
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    if (status === "active") {
      const activeScope = (
        await transactionDb
          .select({ id: campaignPdvs.id })
          .from(campaignPdvs)
          .where(
            and(
              eq(campaignPdvs.campaignId, campaignId),
              eq(campaignPdvs.partnerId, context.partnerId),
              eq(campaignPdvs.isActive, true)
            )
          )
          .limit(1)
      )[0];
      if (!activeScope)
        throw new Error(
          "A campanha precisa ter ao menos um PDV ativo para ser ativada"
        );
    }
    await tx
      .update(campaigns)
      .set({
        status,
        archivedAt: status === "archived" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.partnerId, context.partnerId)
        )
      );
    const action =
      status === "active"
        ? "campaign_activated"
        : status === "closed"
          ? "campaign_closed"
          : "campaign_archived";
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action,
      entityType: "campaign",
      entityId: campaignId,
      metadata: { from: current.status, to: status },
    });
  });
}

export async function setCampaignFrozen(
  context: PartnerContext,
  campaignId: number,
  isFrozen: boolean
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const current = await getCampaignInPartner(db, context, campaignId);
  if (!canFreezeCampaign(current.status))
    throw new Error("Campanhas arquivadas não podem ser congeladas");
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx
      .update(campaigns)
      .set({ isFrozen, updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.partnerId, context.partnerId)
        )
      );
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: isFrozen ? "campaign_frozen" : "campaign_unfrozen",
      entityType: "campaign",
      entityId: campaignId,
    });
  });
}

/** Permanently removes only a never-operated draft, preserving audit evidence first. */
export async function deleteDraftCampaign(
  context: PartnerContext,
  campaignId: number
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const campaign = await getCampaignInPartner(
      transactionDb,
      context,
      campaignId
    );
    if (campaign.status !== "draft")
      throw new Error("Somente campanhas em rascunho podem ser excluídas");
    // The conditional delete makes the eligibility check and deletion one atomic operation.
    const leadCount =
      (
        await transactionDb
          .select({ total: count() })
          .from(leads)
          .where(
            and(
              eq(leads.partnerId, context.partnerId),
              eq(leads.campaignId, campaignId)
            )
          )
      )[0]?.total ?? 0;
    if (Number(leadCount) > 0)
      throw new Error("Campanhas com Leads não podem ser excluídas");
    const importCount =
      (
        await transactionDb
          .select({ total: count() })
          .from(leadImportBatches)
          .where(
            and(
              eq(leadImportBatches.partnerId, context.partnerId),
              eq(leadImportBatches.campaignId, campaignId)
            )
          )
      )[0]?.total ?? 0;
    if (Number(importCount) > 0)
      throw new Error(
        "Campanhas com histórico de importação não podem ser excluídas"
      );

    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "campaign_deleted_draft",
      entityType: "campaign",
      entityId: campaignId,
      metadata: {
        code: campaign.code,
        name: campaign.name,
        status: campaign.status,
      },
    });
    // Audit FK restricts campaign deletion only through campaign fields, not the audit entity.
    // These configuration-only records are safe to remove only after the
    // operational-history checks above have passed.
    await tx
      .delete(campaignGovernanceOverrides)
      .where(
        and(
          eq(campaignGovernanceOverrides.partnerId, context.partnerId),
          eq(campaignGovernanceOverrides.campaignId, campaignId)
        )
      );
    await tx
      .delete(campaignImportPolicies)
      .where(
        and(
          eq(campaignImportPolicies.partnerId, context.partnerId),
          eq(campaignImportPolicies.campaignId, campaignId)
        )
      );
    await tx
      .delete(campaignPdvs)
      .where(
        and(
          eq(campaignPdvs.partnerId, context.partnerId),
          eq(campaignPdvs.campaignId, campaignId)
        )
      );
    const deleted = await tx
      .delete(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.partnerId, context.partnerId),
          eq(campaigns.status, "draft"),
          sql`not exists (select 1 from leads where leads.partnerId = ${context.partnerId} and leads.campaignId = ${campaignId})`
        )
      );
    const affected = Number(
      (deleted as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
    );
    if (affected !== 1)
      throw new Error(
        "A campanha recebeu atividade enquanto era excluída. Tente novamente."
      );
  });
}

export async function listCampaigns(
  context: PartnerContext,
  includeArchived = false
) {
  const db = await getV2Db();
  const fields = {
    id: campaigns.id,
    partnerId: campaigns.partnerId,
    code: campaigns.code,
    name: campaigns.name,
    description: campaigns.description,
    status: campaigns.status,
    isFrozen: campaigns.isFrozen,
    startsAt: campaigns.startsAt,
    endsAt: campaigns.endsAt,
    archivedAt: campaigns.archivedAt,
    createdAt: campaigns.createdAt,
    updatedAt: campaigns.updatedAt,
  };
  if (context.role === "super_admin" || context.role === "partner_admin") {
    const filters = [eq(campaigns.partnerId, context.partnerId)];
    if (!includeArchived) filters.push(ne(campaigns.status, "archived"));
    return db
      .select(fields)
      .from(campaigns)
      .where(and(...filters))
      .orderBy(desc(campaigns.createdAt));
  }
  const filters = [
    eq(campaigns.partnerId, context.partnerId),
    eq(campaignPdvs.partnerId, context.partnerId),
    eq(campaignPdvs.isActive, true),
    eq(userPdvAssignments.partnerId, context.partnerId),
    eq(userPdvAssignments.membershipId, context.membershipId!),
    eq(userPdvAssignments.isActive, true),
    eq(pdvs.isActive, true),
  ];
  if (!includeArchived) filters.push(ne(campaigns.status, "archived"));
  return db
    .selectDistinct(fields)
    .from(campaigns)
    .innerJoin(campaignPdvs, eq(campaignPdvs.campaignId, campaigns.id))
    .innerJoin(
      userPdvAssignments,
      eq(userPdvAssignments.pdvId, campaignPdvs.pdvId)
    )
    .innerJoin(pdvs, eq(pdvs.id, campaignPdvs.pdvId))
    .where(and(...filters))
    .orderBy(desc(campaigns.createdAt));
}

export async function getCampaignDetail(
  context: PartnerContext,
  campaignId: number
) {
  const db = await getV2Db();
  const campaign = await assertCampaignScope(db, context, campaignId);
  const scopeRows = await db
    .select({
      id: pdvs.id,
      code: pdvs.code,
      name: pdvs.name,
      city: pdvs.city,
      region: pdvs.region,
      isActive: pdvs.isActive,
      relationActive: campaignPdvs.isActive,
    })
    .from(campaignPdvs)
    .innerJoin(pdvs, eq(pdvs.id, campaignPdvs.pdvId))
    .where(
      and(
        eq(campaignPdvs.partnerId, context.partnerId),
        eq(campaignPdvs.campaignId, campaignId),
        eq(campaignPdvs.isActive, true)
      )
    );
  let pdvScope = scopeRows;
  if (context.role !== "super_admin" && context.role !== "partner_admin") {
    const assignments = await db
      .select({ pdvId: userPdvAssignments.pdvId })
      .from(userPdvAssignments)
      .where(
        and(
          eq(userPdvAssignments.partnerId, context.partnerId),
          eq(userPdvAssignments.membershipId, context.membershipId!),
          eq(userPdvAssignments.isActive, true)
        )
      );
    const allowedPdvIds = new Set(
      assignments.map(assignment => assignment.pdvId)
    );
    pdvScope = scopeRows.filter(pdv => allowedPdvIds.has(pdv.id));
  }
  const metrics = !pdvScope.length
    ? {
        status: "available" as const,
        total: 0,
        available: 0,
        inProgress: 0,
        completed: 0,
      }
    : ((
        await db
          .select({
            total: count(),
            available: sql<number>`coalesce(sum(case when ${leads.assignedMembershipId} is null then 1 else 0 end), 0)`,
            inProgress: sql<number>`coalesce(sum(case when ${leadStatuses.category} = 'in_progress' then 1 else 0 end), 0)`,
            completed: sql<number>`coalesce(sum(case when ${leadStatuses.category} in ('completed', 'discarded') then 1 else 0 end), 0)`,
          })
          .from(leads)
          .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
          .where(
            and(
              eq(leads.partnerId, context.partnerId),
              eq(leads.campaignId, campaignId),
              isNull(leads.deletedAt),
              inArray(
                leads.pdvId,
                pdvScope.map(pdv => pdv.id)
              )
            )
          )
      )[0] ?? { total: 0, available: 0, inProgress: 0, completed: 0 });
  return {
    campaign,
    pdvs: pdvScope,
    metrics: {
      status: "available" as const,
      total: Number(metrics.total),
      available: Number(metrics.available),
      inProgress: Number(metrics.inProgress),
      completed: Number(metrics.completed),
    },
    futureSections: ["Importações", "Distribuição", "Histórico"] as const,
  };
}
