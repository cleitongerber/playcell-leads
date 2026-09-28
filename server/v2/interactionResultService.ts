import { and, eq } from "drizzle-orm";
import { leadInteractionResults, leadStatuses } from "../../drizzle-v2/schema";
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
          .select({ id: leadInteractionResults.id })
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
