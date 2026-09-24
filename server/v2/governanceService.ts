import { and, eq } from "drizzle-orm";
import {
  campaignGovernanceOverrides,
  campaigns,
  partnerGovernanceRules,
} from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import {
  defaultGovernanceRule,
  normalizeRule,
  selectEffectiveGovernance,
  type GovernanceRule,
} from "./governancePolicy";
import { requirePdvAdministration } from "./operationalScope";
import { writeV2Audit } from "./partnerService";

type RuleRow = typeof partnerGovernanceRules.$inferSelect;
type OverrideRow = typeof campaignGovernanceOverrides.$inferSelect;

function toStringList(value: unknown) {
  return Array.isArray(value) && value.every(item => typeof item === "string")
    ? value
    : null;
}

function fromRuleRow(row: RuleRow | OverrideRow | undefined): GovernanceRule {
  if (!row) return { ...defaultGovernanceRule };
  return normalizeRule({
    evidenceRequired: row.evidenceRequired,
    noteRequired: row.noteRequired,
    followUpRequired: row.followUpRequired,
    allowedChannels: toStringList(row.allowedChannels),
    allowedOutcomes: toStringList(row.allowedOutcomes),
    allowedEvidenceMimeTypes: toStringList(row.allowedEvidenceMimeTypes),
    maxEvidenceSizeBytes: row.maxEvidenceSizeBytes,
    retentionDays: row.retentionDays,
  });
}

export async function resolveEffectiveGovernance(
  db: V2Database,
  partnerId: number,
  campaignId: number
) {
  const partnerRule = (
    await db
      .select()
      .from(partnerGovernanceRules)
      .where(eq(partnerGovernanceRules.partnerId, partnerId))
      .limit(1)
  )[0];
  const override = (
    await db
      .select()
      .from(campaignGovernanceOverrides)
      .where(
        and(
          eq(campaignGovernanceOverrides.partnerId, partnerId),
          eq(campaignGovernanceOverrides.campaignId, campaignId),
          eq(campaignGovernanceOverrides.mode, "override")
        )
      )
      .limit(1)
  )[0];
  return selectEffectiveGovernance(
    fromRuleRow(partnerRule),
    override ? fromRuleRow(override) : null
  );
}

export async function getPartnerGovernance(context: PartnerContext) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const row = (
    await db
      .select()
      .from(partnerGovernanceRules)
      .where(eq(partnerGovernanceRules.partnerId, context.partnerId))
      .limit(1)
  )[0];
  return fromRuleRow(row);
}

export async function updatePartnerGovernance(
  context: PartnerContext,
  input: GovernanceRule
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  const rule = normalizeRule(input);
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx
      .insert(partnerGovernanceRules)
      .values({ partnerId: context.partnerId, ...rule })
      .onDuplicateKeyUpdate({ set: { ...rule, updatedAt: new Date() } });
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "partner_governance_updated",
      entityType: "partner_governance_rule",
      entityId: context.partnerId,
      metadata: {
        evidenceRequired: rule.evidenceRequired,
        noteRequired: rule.noteRequired,
        followUpRequired: rule.followUpRequired,
        retentionDays: rule.retentionDays,
      },
    });
  });
  return rule;
}

async function assertCampaignInPartner(
  db: V2Database,
  context: PartnerContext,
  campaignId: number
) {
  const campaign = (
    await db
      .select({ id: campaigns.id })
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
}

export async function getCampaignGovernance(
  context: PartnerContext,
  campaignId: number
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  await assertCampaignInPartner(db, context, campaignId);
  const effective = await resolveEffectiveGovernance(
    db,
    context.partnerId,
    campaignId
  );
  return effective;
}

export async function setCampaignGovernance(
  context: PartnerContext,
  campaignId: number,
  input: { mode: "inherit" } | { mode: "override"; rule: GovernanceRule }
) {
  requirePdvAdministration(context);
  const db = await getV2Db();
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await assertCampaignInPartner(transactionDb, context, campaignId);
    if (input.mode === "inherit") {
      await tx
        .delete(campaignGovernanceOverrides)
        .where(
          and(
            eq(campaignGovernanceOverrides.partnerId, context.partnerId),
            eq(campaignGovernanceOverrides.campaignId, campaignId)
          )
        );
      await writeV2Audit(transactionDb, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "campaign_governance_inherited",
        entityType: "campaign_governance_override",
        entityId: campaignId,
        metadata: { mode: "inherit" },
      });
      return;
    }
    const rule = normalizeRule(input.rule);
    await tx
      .insert(campaignGovernanceOverrides)
      .values({
        partnerId: context.partnerId,
        campaignId,
        mode: "override",
        ...rule,
      })
      .onDuplicateKeyUpdate({
        set: { mode: "override", ...rule, updatedAt: new Date() },
      });
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "campaign_governance_overridden",
      entityType: "campaign_governance_override",
      entityId: campaignId,
      metadata: {
        mode: "override",
        evidenceRequired: rule.evidenceRequired,
        noteRequired: rule.noteRequired,
        followUpRequired: rule.followUpRequired,
        retentionDays: rule.retentionDays,
      },
    });
  });
  return getCampaignGovernance(context, campaignId);
}
