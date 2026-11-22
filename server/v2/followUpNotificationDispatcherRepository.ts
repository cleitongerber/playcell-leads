import { and, eq, gt, isNull, lte } from "drizzle-orm";
import {
  campaigns,
  followUpNotificationDeliveries,
  followUps,
  leadStatuses,
  leads,
  partnerSettings,
  pdvs,
  pushSubscriptions,
  userPartners,
  userPdvAssignments,
  users,
} from "../../drizzle-v2/schema";
import type {
  DeliveryRevalidation,
  DispatchCandidate,
  FollowUpNotificationDispatcherRepository,
  PendingDelivery,
} from "./followUpNotificationDispatcher";
import {
  claimFollowUpNotificationDelivery,
  enqueueFollowUpNotificationDelivery,
  finishFollowUpNotificationDelivery,
} from "./followUpNotificationOutbox";
import { writeV2Audit } from "./partnerService";
import { invalidatePushSubscription } from "./pushSubscriptionService";
import type { V2Database } from "./database";

type PartnerNotificationSettings = {
  webPushFollowUpAutomationEnabled?: unknown;
};

function notificationSettings(value: unknown): PartnerNotificationSettings | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value))
    return value as PartnerNotificationSettings;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as PartnerNotificationSettings
      : null;
  } catch {
    return null;
  }
}

async function sellerHasPdvScope(
  db: V2Database,
  input: { partnerId: number; membershipId: number; pdvId: number; scopeMode: "all" | "specific" }
) {
  if (input.scopeMode === "all") return true;
  const row = await db
    .select({ id: userPdvAssignments.id })
    .from(userPdvAssignments)
    .where(and(
      eq(userPdvAssignments.partnerId, input.partnerId),
      eq(userPdvAssignments.membershipId, input.membershipId),
      eq(userPdvAssignments.pdvId, input.pdvId),
      eq(userPdvAssignments.isActive, true)
    ))
    .limit(1);
  return Boolean(row[0]);
}

/**
 * Database adapter only: callers still must inject it into the single-run
 * dispatcher. This module does not register a timer, HTTP route or provider.
 */
export function createFollowUpNotificationDispatcherRepository(
  db: V2Database
): FollowUpNotificationDispatcherRepository {
  return {
    async listDispatchCandidates({ now, batchSize }) {
      const rows = await db
        .select({
          partnerId: followUps.partnerId,
          followUpId: followUps.id,
          notificationVersion: followUps.notificationVersion,
          dueAt: followUps.dueAt,
          leadId: leads.id,
          ownerMembershipId: followUps.ownerMembershipId,
          leadOwnerMembershipId: leads.assignedMembershipId,
          pdvId: leads.pdvId,
          leadDeletedAt: leads.deletedAt,
          leadTerminal: leadStatuses.isTerminal,
          campaignStatus: campaigns.status,
          campaignFrozen: campaigns.isFrozen,
          pdvActive: pdvs.isActive,
          memberRole: userPartners.role,
          memberActive: userPartners.isActive,
          scopeMode: userPartners.pdvScopeMode,
          userId: users.id,
          userActive: users.isActive,
          subscriptionId: pushSubscriptions.id,
          subscriptionActive: pushSubscriptions.status,
          notificationSettings: partnerSettings.notificationSettings,
        })
        .from(followUps)
        .innerJoin(leads, and(eq(leads.id, followUps.leadId), eq(leads.partnerId, followUps.partnerId)))
        .innerJoin(campaigns, and(eq(campaigns.id, leads.campaignId), eq(campaigns.partnerId, leads.partnerId)))
        .innerJoin(leadStatuses, and(eq(leadStatuses.id, leads.statusId), eq(leadStatuses.partnerId, leads.partnerId)))
        .innerJoin(pdvs, and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId)))
        .innerJoin(userPartners, and(eq(userPartners.id, followUps.ownerMembershipId), eq(userPartners.partnerId, followUps.partnerId)))
        .innerJoin(users, eq(users.id, userPartners.userId))
        .innerJoin(pushSubscriptions, and(eq(pushSubscriptions.partnerId, followUps.partnerId), eq(pushSubscriptions.membershipId, followUps.ownerMembershipId), eq(pushSubscriptions.userId, userPartners.userId)))
        .innerJoin(partnerSettings, eq(partnerSettings.partnerId, followUps.partnerId))
        .where(and(eq(followUps.status, "pending"), lte(followUps.dueAt, new Date(now.getTime() + 60 * 60 * 1000))))
        .limit(batchSize * 8);

      const grouped = new Map<string, DispatchCandidate>();
      for (const row of rows) {
        const structurallyEligible =
          row.leadDeletedAt === null &&
          !row.leadTerminal &&
          row.campaignStatus === "active" &&
          !row.campaignFrozen &&
          row.pdvActive &&
          row.memberRole === "seller" &&
          row.memberActive &&
          row.userActive &&
          row.subscriptionActive === "active" &&
          row.leadOwnerMembershipId === row.ownerMembershipId &&
          (await sellerHasPdvScope(db, { partnerId: row.partnerId, membershipId: row.ownerMembershipId, pdvId: row.pdvId, scopeMode: row.scopeMode }));
        if (!structurallyEligible) continue;
        const key = `${row.followUpId}:${row.notificationVersion}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.subscriptionIds = [...existing.subscriptionIds, row.subscriptionId];
          continue;
        }
        grouped.set(key, {
          partnerId: row.partnerId,
          followUpId: row.followUpId,
          notificationVersion: row.notificationVersion,
          dueAt: row.dueAt,
          leadId: row.leadId,
          subscriptionIds: [row.subscriptionId],
          partnerSettings: notificationSettings(row.notificationSettings),
        });
      }
      return Array.from(grouped.values()).slice(0, batchSize);
    },

    async enqueue(input) {
      await enqueueFollowUpNotificationDelivery(db, input);
    },

    async listPendingDeliveries({ now, batchSize }) {
      return db
        .select({
          id: followUpNotificationDeliveries.id,
          partnerId: followUpNotificationDeliveries.partnerId,
          followUpId: followUpNotificationDeliveries.followUpId,
          notificationVersion: followUpNotificationDeliveries.notificationVersion,
          stage: followUpNotificationDeliveries.stage,
          subscriptionId: followUpNotificationDeliveries.subscriptionId,
        })
        .from(followUpNotificationDeliveries)
        .where(and(
          eq(followUpNotificationDeliveries.status, "pending"),
          lte(followUpNotificationDeliveries.scheduledFor, now),
          gt(followUpNotificationDeliveries.eligibleUntil, now)
        ))
        .limit(batchSize) as Promise<PendingDelivery[]>;
    },

    async claim(input) { return claimFollowUpNotificationDelivery(db, input); },

    async revalidate({ delivery }): Promise<DeliveryRevalidation> {
      const row = (await db
        .select({
          deliveryPartnerId: followUpNotificationDeliveries.partnerId,
          deliveryVersion: followUpNotificationDeliveries.notificationVersion,
          followUpStatus: followUps.status,
          followUpVersion: followUps.notificationVersion,
          followUpOwner: followUps.ownerMembershipId,
          leadId: leads.id,
          leadOwner: leads.assignedMembershipId,
          leadDeletedAt: leads.deletedAt,
          pdvId: leads.pdvId,
          leadTerminal: leadStatuses.isTerminal,
          campaignStatus: campaigns.status,
          campaignFrozen: campaigns.isFrozen,
          pdvActive: pdvs.isActive,
          membershipId: userPartners.id,
          membershipRole: userPartners.role,
          membershipActive: userPartners.isActive,
          scopeMode: userPartners.pdvScopeMode,
          userId: users.id,
          userActive: users.isActive,
          subscriptionId: pushSubscriptions.id,
          subscriptionPartnerId: pushSubscriptions.partnerId,
          subscriptionUserId: pushSubscriptions.userId,
          subscriptionMembershipId: pushSubscriptions.membershipId,
          subscriptionStatus: pushSubscriptions.status,
          notificationSettings: partnerSettings.notificationSettings,
        })
        .from(followUpNotificationDeliveries)
        .innerJoin(followUps, eq(followUps.id, followUpNotificationDeliveries.followUpId))
        .innerJoin(leads, and(eq(leads.id, followUps.leadId), eq(leads.partnerId, followUps.partnerId)))
        .innerJoin(campaigns, and(eq(campaigns.id, leads.campaignId), eq(campaigns.partnerId, leads.partnerId)))
        .innerJoin(leadStatuses, and(eq(leadStatuses.id, leads.statusId), eq(leadStatuses.partnerId, leads.partnerId)))
        .innerJoin(pdvs, and(eq(pdvs.id, leads.pdvId), eq(pdvs.partnerId, leads.partnerId)))
        .innerJoin(userPartners, and(eq(userPartners.id, followUps.ownerMembershipId), eq(userPartners.partnerId, followUps.partnerId)))
        .innerJoin(users, eq(users.id, userPartners.userId))
        .innerJoin(pushSubscriptions, eq(pushSubscriptions.id, followUpNotificationDeliveries.subscriptionId))
        .innerJoin(partnerSettings, eq(partnerSettings.partnerId, followUps.partnerId))
        .where(and(eq(followUpNotificationDeliveries.id, delivery.id), eq(followUpNotificationDeliveries.partnerId, delivery.partnerId)))
        .limit(1))[0];
      if (!row) return { eligible: false, reason: "delivery_not_found" };
      if (
        row.followUpStatus !== "pending" ||
        row.deliveryVersion !== row.followUpVersion ||
        row.leadDeletedAt !== null ||
        row.leadTerminal ||
        row.campaignStatus !== "active" ||
        row.campaignFrozen ||
        !row.pdvActive ||
        row.membershipRole !== "seller" ||
        !row.membershipActive ||
        !row.userActive ||
        row.followUpOwner !== row.leadOwner ||
        row.subscriptionStatus !== "active" ||
        row.subscriptionPartnerId !== row.deliveryPartnerId ||
        row.subscriptionUserId !== row.userId ||
        row.subscriptionMembershipId !== row.membershipId
      ) return { eligible: false, reason: "eligibility_changed" };
      if (!(await sellerHasPdvScope(db, { partnerId: row.deliveryPartnerId, membershipId: row.membershipId, pdvId: row.pdvId, scopeMode: row.scopeMode })))
        return { eligible: false, reason: "pdv_scope_invalid" };
      return {
        eligible: true,
        leadId: row.leadId,
        actorUserId: row.userId,
        actorMembershipId: row.membershipId,
        partnerSettings: notificationSettings(row.notificationSettings),
      };
    },

    async finish(input) { return finishFollowUpNotificationDelivery(db, input); },
    async invalidateSubscription({ subscriptionId }) { await invalidatePushSubscription(subscriptionId); },
    async audit(input) {
      await writeV2Audit(db, {
        partnerId: input.partnerId,
        actorUserId: input.actorUserId,
        actorMembershipId: input.actorMembershipId,
        action: input.action,
        entityType: "follow_up_notification_delivery",
        entityId: input.deliveryId,
        metadata: input.metadata,
      });
    },
  };
}
