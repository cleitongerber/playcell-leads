import { and, count, eq, isNull } from "drizzle-orm";
import {
  leadEvidences,
  leadTimelineEvents,
  leadTreatmentGovernance,
  leads,
  userPdvAssignments,
} from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import {
  createEvidenceStorageKey,
  EvidenceStorageConfigurationError,
  getEvidenceStorage,
  resolveEvidenceStorageProvider,
  validateEvidenceUpload,
  type EvidenceStorage,
  type EvidenceStorageProvider,
} from "./evidenceStorage";
import {
  assertEvidenceLeadScope,
  assertEvidenceTimelineTarget,
} from "./evidencePolicy";
import { getV2Db, type V2Database } from "./database";
import { resolveEffectiveGovernance } from "./governanceService";
import { writeV2Audit } from "./partnerService";

async function scopedPdvIds(db: V2Database, context: PartnerContext) {
  if (context.role === "super_admin" || context.role === "partner_admin")
    return null;
  return (
    await db
      .select({ pdvId: userPdvAssignments.pdvId })
      .from(userPdvAssignments)
      .where(
        and(
          eq(userPdvAssignments.partnerId, context.partnerId),
          eq(userPdvAssignments.membershipId, context.membershipId!),
          eq(userPdvAssignments.isActive, true)
        )
      )
  ).map(row => row.pdvId);
}

async function loadAccessibleLead(
  db: V2Database,
  context: PartnerContext,
  leadId: number
) {
  const lead = (
    await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.partnerId, context.partnerId),
          isNull(leads.deletedAt)
        )
      )
      .limit(1)
  )[0];
  if (!lead) throw new Error("Lead não encontrado");
  const scope = await scopedPdvIds(db, context);
  assertEvidenceLeadScope(context, lead, scope);
  return lead;
}

async function assertTimelineEventForLead(
  db: V2Database,
  context: PartnerContext,
  leadId: number,
  timelineEventId: number
) {
  const event = (
    await db
      .select({
        id: leadTimelineEvents.id,
        partnerId: leadTimelineEvents.partnerId,
        leadId: leadTimelineEvents.leadId,
      })
      .from(leadTimelineEvents)
      .where(
        and(
          eq(leadTimelineEvents.id, timelineEventId),
          eq(leadTimelineEvents.partnerId, context.partnerId),
          eq(leadTimelineEvents.leadId, leadId)
        )
      )
      .limit(1)
  )[0];
  assertEvidenceTimelineTarget({ partnerId: context.partnerId, leadId }, event);
}

/** Intentionally excludes storage keys, object URLs and any file content. */
export function evidenceAuditMetadata(input: {
  leadId: number;
  timelineEventId: number;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
}) {
  return {
    leadId: input.leadId,
    timelineEventId: input.timelineEventId,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.checksum ? { checksum: input.checksum } : {}),
  };
}

export async function uploadLeadEvidence(
  context: PartnerContext,
  input: {
    leadId: number;
    timelineEventId: number;
    fileName: string;
    mimeType: string;
    base64: string;
  },
  storage?: EvidenceStorage
) {
  if (!context.membershipId)
    throw new Error("Uma membership ativa é necessária para anexar evidências");
  const storageProvider: EvidenceStorageProvider = storage
    ? "forge_s3"
    : resolveEvidenceStorageProvider();
  const activeStorage = storage ?? getEvidenceStorage(storageProvider);
  const db = await getV2Db();
  const lead = await loadAccessibleLead(db, context, input.leadId);
  await assertTimelineEventForLead(db, context, lead.id, input.timelineEventId);
  const effective = await resolveEffectiveGovernance(
    db,
    context.partnerId,
    lead.campaignId
  );
  const upload = validateEvidenceUpload(input, effective.rule);
  const storageKey = createEvidenceStorageKey(context.partnerId);
  const evidenceId = await db.transaction(async tx => {
    const inserted = await tx.insert(leadEvidences).values({
      partnerId: context.partnerId,
      leadId: lead.id,
      timelineEventId: input.timelineEventId,
      uploadedByMembershipId: context.membershipId!,
      storageProvider,
      storageKey,
      storageStatus: "uploading",
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      checksum: upload.checksum,
    });
    const id = Number(
      (inserted as unknown as [{ insertId?: number }])[0]?.insertId
    );
    if (!id) throw new Error("Não foi possível preparar a evidência");
    return id;
  });

  let storageUploaded = false;
  try {
    await activeStorage.put(storageKey, upload.bytes, upload.mimeType);
    storageUploaded = true;
    await db.transaction(async tx => {
      const transactionDb = tx as unknown as V2Database;
      await tx
        .update(leadEvidences)
        .set({ storageStatus: "available" })
        .where(
          and(
            eq(leadEvidences.id, evidenceId),
            eq(leadEvidences.partnerId, context.partnerId),
            eq(leadEvidences.storageStatus, "uploading")
          )
        );
      const governance = (
        await transactionDb
          .select()
          .from(leadTreatmentGovernance)
          .where(
            and(
              eq(leadTreatmentGovernance.partnerId, context.partnerId),
              eq(leadTreatmentGovernance.timelineEventId, input.timelineEventId)
            )
          )
          .limit(1)
      )[0];
      if (governance) {
        const complete =
          governance.noteSatisfied && governance.followUpSatisfied;
        await tx
          .update(leadTreatmentGovernance)
          .set({
            evidenceSatisfied: true,
            isComplete: complete,
            completedAt: complete ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(leadTreatmentGovernance.id, governance.id));
      }
      await writeV2Audit(transactionDb, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "lead_evidence_uploaded",
        entityType: "lead_evidence",
        entityId: evidenceId,
        metadata: evidenceAuditMetadata({
          leadId: lead.id,
          timelineEventId: input.timelineEventId,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          checksum: upload.checksum,
        }),
      });
    });
    return evidenceId;
  } catch (error) {
    if (!storageUploaded) {
      await db
        .update(leadEvidences)
        .set({ storageStatus: "failed" })
        .where(
          and(
            eq(leadEvidences.id, evidenceId),
            eq(leadEvidences.partnerId, context.partnerId),
            eq(leadEvidences.storageStatus, "uploading")
          )
        )
        .catch(() => undefined);
    }
    if (error instanceof EvidenceStorageConfigurationError) throw error;
    throw new Error("Não foi possível enviar a evidência");
  }
}

async function loadAccessibleEvidence(
  db: V2Database,
  context: PartnerContext,
  evidenceId: number
) {
  const evidence = (
    await db
      .select()
      .from(leadEvidences)
      .where(
        and(
          eq(leadEvidences.id, evidenceId),
          eq(leadEvidences.partnerId, context.partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!evidence) throw new Error("Evidência não encontrada");
  const lead = await loadAccessibleLead(db, context, evidence.leadId);
  return { evidence, lead };
}

export async function getEvidenceDownloadUrl(
  context: PartnerContext,
  evidenceId: number,
  storage?: EvidenceStorage
) {
  const db = await getV2Db();
  const { evidence } = await loadAccessibleEvidence(db, context, evidenceId);
  if (evidence.deletedAt || evidence.storageStatus !== "available") {
    throw new Error("Evidência indisponível");
  }
  // Never log or persist the signed URL; it is generated only after access checks.
  const activeStorage =
    storage ??
    getEvidenceStorage(evidence.storageProvider as EvidenceStorageProvider);
  return { url: await activeStorage.getSignedUrl(evidence.storageKey) };
}

export async function softDeleteLeadEvidence(
  context: PartnerContext,
  evidenceId: number
) {
  if (context.role !== "super_admin" && context.role !== "partner_admin") {
    throw new Error("Apenas administradores podem remover evidências");
  }
  const db = await getV2Db();
  const { evidence, lead } = await loadAccessibleEvidence(
    db,
    context,
    evidenceId
  );
  if (evidence.deletedAt) return { idempotent: true };
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx
      .update(leadEvidences)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(leadEvidences.id, evidenceId),
          eq(leadEvidences.partnerId, context.partnerId),
          isNull(leadEvidences.deletedAt)
        )
      );
    const remaining = (
      await transactionDb
        .select({ total: count() })
        .from(leadEvidences)
        .where(
          and(
            eq(leadEvidences.partnerId, context.partnerId),
            eq(leadEvidences.timelineEventId, evidence.timelineEventId),
            eq(leadEvidences.storageStatus, "available"),
            isNull(leadEvidences.deletedAt)
          )
        )
    )[0];
    if (Number(remaining?.total ?? 0) === 0) {
      const governance = (
        await transactionDb
          .select()
          .from(leadTreatmentGovernance)
          .where(
            and(
              eq(leadTreatmentGovernance.partnerId, context.partnerId),
              eq(
                leadTreatmentGovernance.timelineEventId,
                evidence.timelineEventId
              )
            )
          )
          .limit(1)
      )[0];
      if (governance && !governance.evidenceSatisfied) {
        // Already incomplete; keep its original state unchanged.
      } else if (governance) {
        const rule = governance.appliedRuleJson as {
          evidenceRequired?: boolean;
        };
        if (rule.evidenceRequired) {
          await tx
            .update(leadTreatmentGovernance)
            .set({
              evidenceSatisfied: false,
              isComplete: false,
              completedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(leadTreatmentGovernance.id, governance.id));
        }
      }
    }
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_evidence_soft_deleted",
      entityType: "lead_evidence",
      entityId: evidenceId,
      metadata: evidenceAuditMetadata({
        leadId: lead.id,
        timelineEventId: evidence.timelineEventId,
      }),
    });
  });
  return { idempotent: false };
}
