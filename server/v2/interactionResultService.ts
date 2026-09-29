import { and, eq, inArray } from "drizzle-orm";
import {
  leadContactAttempts,
  leadContacts,
  leadConversions,
  leadInteractionResults,
  leadStatuses,
} from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import { listPartnerInteractionResults } from "./leadConfiguration";
import {
  normalizeInteractionResultConfiguration,
  type InteractionResultConfiguration,
} from "./interactionResultPolicy";
import { requirePdvAdministration } from "./operationalScope";
import { writeV2Audit } from "./partnerService";

async function loadSuggestedStatus(
  db: V2Database,
  partnerId: number,
  statusId: number | null
) {
  if (!statusId) return null;
  const status = (
    await db
      .select()
      .from(leadStatuses)
      .where(
        and(
          eq(leadStatuses.id, statusId),
          eq(leadStatuses.partnerId, partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!status || !status.isActive) {
    throw new Error("Situação sugerida não está disponível neste parceiro");
  }
  return status;
}

export async function listInteractionResultConfiguration(
  context: PartnerContext,
  interactionKind?: InteractionResultConfiguration["interactionKind"],
  includeInactive = false
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  return listPartnerInteractionResults(
    db,
    context.partnerId,
    interactionKind,
    includeInactive
  );
}

/**
 * Backend configuration only. No 016.1 UI invokes this yet, but the write is
 * fully tenant-scoped and auditable for the later administrative surface.
 */
export async function saveInteractionResultConfiguration(
  context: PartnerContext,
  input: InteractionResultConfiguration & { id?: number }
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const configuration = normalizeInteractionResultConfiguration(input);
  const suggestedStatus = await loadSuggestedStatus(
    db,
    context.partnerId,
    configuration.suggestedStatusId
  );
  if (
    configuration.conversionMode === "eligible" &&
    (!suggestedStatus ||
      !suggestedStatus.isTerminal ||
      suggestedStatus.category !== "completed")
  ) {
    throw new Error(
      "Resultado de conversão exige uma situação terminal de conversão"
    );
  }

  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const values = {
      interactionKind: configuration.interactionKind,
      code: configuration.code,
      label: configuration.label,
      category: configuration.category,
      suggestedStatusId: configuration.suggestedStatusId,
      statusPolicy: configuration.statusPolicy,
      allowSellerOverride: configuration.allowSellerOverride,
      followUpPolicy: configuration.followUpPolicy,
      conversionMode: configuration.conversionMode,
      isActive: configuration.isActive,
      sortOrder: configuration.sortOrder,
      updatedAt: new Date(),
    };
    let id = input.id;
    if (id) {
      const existing = (
        await transactionDb
          .select({
            id: leadInteractionResults.id,
            code: leadInteractionResults.code,
            interactionKind: leadInteractionResults.interactionKind,
          })
          .from(leadInteractionResults)
          .where(
            and(
              eq(leadInteractionResults.id, id),
              eq(leadInteractionResults.partnerId, context.partnerId)
            )
          )
          .limit(1)
      )[0];
      if (!existing) throw new Error("Resultado não encontrado");
      if (
        existing.code !== configuration.code ||
        existing.interactionKind !== configuration.interactionKind
      ) {
        const [attempt, contact, conversion] = await Promise.all([
          transactionDb
            .select({ id: leadContactAttempts.id })
            .from(leadContactAttempts)
            .where(
              and(
                eq(leadContactAttempts.partnerId, context.partnerId),
                eq(leadContactAttempts.resultId, id)
              )
            )
            .limit(1),
          transactionDb
            .select({ id: leadContacts.id })
            .from(leadContacts)
            .where(
              and(
                eq(leadContacts.partnerId, context.partnerId),
                eq(leadContacts.resultId, id)
              )
            )
            .limit(1),
          transactionDb
            .select({ id: leadConversions.id })
            .from(leadConversions)
            .where(
              and(
                eq(leadConversions.partnerId, context.partnerId),
                eq(leadConversions.resultId, id)
              )
            )
            .limit(1),
        ]);
        if (attempt[0] || contact[0] || conversion[0]) {
          throw new Error(
            "Não é possível alterar o código ou tipo de um resultado já utilizado"
          );
        }
      }
      await tx
        .update(leadInteractionResults)
        .set(values)
        .where(
          and(
            eq(leadInteractionResults.id, id),
            eq(leadInteractionResults.partnerId, context.partnerId)
          )
        );
    } else {
      const inserted = await tx.insert(leadInteractionResults).values({
        partnerId: context.partnerId,
        ...values,
      });
      id = Number(
        (inserted as unknown as [{ insertId?: number }])[0]?.insertId
      );
      if (!id) throw new Error("Não foi possível salvar o resultado");
    }
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: input.id
        ? "lead_interaction_result_updated"
        : "lead_interaction_result_created",
      entityType: "lead_interaction_result",
      entityId: id,
      metadata: {
        interactionKind: configuration.interactionKind,
        code: configuration.code,
        category: configuration.category,
        suggestedStatusId: configuration.suggestedStatusId,
        statusPolicy: configuration.statusPolicy,
        followUpPolicy: configuration.followUpPolicy,
        conversionMode: configuration.conversionMode,
        isActive: configuration.isActive,
      },
    });
    return { id };
  });
}

/** Soft retirement keeps historical result snapshots and foreign keys intact. */
export async function deactivateInteractionResult(
  context: PartnerContext,
  id: number
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const existing = (
    await db
      .select()
      .from(leadInteractionResults)
      .where(
        and(
          eq(leadInteractionResults.id, id),
          eq(leadInteractionResults.partnerId, context.partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!existing) throw new Error("Resultado não encontrado");
  if (!existing.isActive) return { id, idempotent: true };
  await saveInteractionResultConfiguration(context, {
    id: existing.id,
    interactionKind: existing.interactionKind,
    code: existing.code,
    label: existing.label,
    category: existing.category,
    suggestedStatusId: existing.suggestedStatusId,
    statusPolicy: existing.statusPolicy,
    allowSellerOverride: existing.allowSellerOverride,
    followUpPolicy: existing.followUpPolicy,
    conversionMode: existing.conversionMode,
    isActive: false,
    sortOrder: existing.sortOrder,
  });
  return { id, idempotent: false };
}

/** A narrow batch command makes ordering auditable without exposing a delete path. */
export async function reorderInteractionResults(
  context: PartnerContext,
  input: Array<{ id: number; sortOrder: number }>
) {
  requirePdvAdministration(context);
  const uniqueIds = new Set(input.map(item => item.id));
  if (!input.length || uniqueIds.size !== input.length) {
    throw new Error("Ordenação de resultados inválida");
  }
  const db = await getV2Db();
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const existing = await transactionDb
      .select({ id: leadInteractionResults.id })
      .from(leadInteractionResults)
      .where(
        and(
          eq(leadInteractionResults.partnerId, context.partnerId),
          inArray(
            leadInteractionResults.id,
            input.map(item => item.id)
          ),
          eq(leadInteractionResults.isActive, true)
        )
      );
    const available = new Set(existing.map(row => row.id));
    if (input.some(item => !available.has(item.id))) {
      throw new Error("Resultado não encontrado ou inativo");
    }
    for (const item of input) {
      await tx
        .update(leadInteractionResults)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(
          and(
            eq(leadInteractionResults.id, item.id),
            eq(leadInteractionResults.partnerId, context.partnerId)
          )
        );
    }
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_interaction_results_reordered",
      entityType: "lead_interaction_result",
      entityId: context.partnerId,
      metadata: { count: input.length },
    });
  });
  return { updated: input.length };
}
