import { and, eq, ne } from "drizzle-orm";
import { pushSubscriptions } from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import { getV2Db, type V2Database } from "./database";
import {
  encryptPushSubscriptionValue,
  hashPushSubscriptionValue,
} from "./pushSubscriptionCrypto";
import { writeV2Audit } from "./partnerService";
import { webPushPublicConfiguration } from "./webPushConfig";

export type BrowserPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
};

function encodedSubscription(input: BrowserPushSubscription) {
  return JSON.stringify({ endpoint: input.endpoint, keys: input.keys });
}

function endpointHash(endpoint: string) {
  return hashPushSubscriptionValue(endpoint);
}

/** A device belongs to the current account only after this server-side binding. */
export async function registerPushSubscription(
  context: PartnerContext,
  input: BrowserPushSubscription
) {
  if (context.membershipId === null)
    throw new Error("Selecione um vínculo de parceiro para ativar notificações.");
  const db = await getV2Db();
  const now = new Date();
  const hash = endpointHash(input.endpoint);
  const endpointCiphertext = encryptPushSubscriptionValue(input.endpoint);
  const keysCiphertext = encryptPushSubscriptionValue(encodedSubscription(input));
  const userAgentHash = input.userAgent
    ? hashPushSubscriptionValue(input.userAgent)
    : null;

  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    // A shared browser endpoint must never remain active for a previous user.
    await tx
      .update(pushSubscriptions)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(pushSubscriptions.endpointHash, hash),
          ne(pushSubscriptions.userId, context.userId),
          eq(pushSubscriptions.status, "active")
        )
      );

    const existing = (
      await transactionDb
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.partnerId, context.partnerId),
            eq(pushSubscriptions.membershipId, context.membershipId!),
            eq(pushSubscriptions.endpointHash, hash)
          )
        )
        .limit(1)
    )[0];
    const values = {
      userId: context.userId,
      endpointCiphertext,
      keysCiphertext,
      userAgentHash,
      status: "active" as const,
      lastSeenAt: now,
      revokedAt: null,
      invalidatedAt: null,
      updatedAt: now,
    };
    if (existing) {
      await tx.update(pushSubscriptions).set(values).where(eq(pushSubscriptions.id, existing.id));
    } else {
      await tx.insert(pushSubscriptions).values({
        ...values,
        partnerId: context.partnerId,
        userId: context.userId,
        membershipId: context.membershipId!,
        endpointHash: hash,
        createdAt: now,
      });
    }
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "push_subscription_registered",
      entityType: "push_subscription",
      entityId: hash.slice(0, 16),
      metadata: { source: "browser", reactivated: Boolean(existing) },
    });
  });
  return { active: true };
}

export async function currentPushSubscription(
  context: PartnerContext,
  endpoint: string
) {
  if (context.membershipId === null) return { active: false };
  const db = await getV2Db();
  const record = (
    await db
      .select({ status: pushSubscriptions.status })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.partnerId, context.partnerId),
          eq(pushSubscriptions.userId, context.userId),
          eq(pushSubscriptions.membershipId, context.membershipId),
          eq(pushSubscriptions.endpointHash, endpointHash(endpoint))
        )
      )
      .limit(1)
  )[0];
  return { active: record?.status === "active" };
}

export async function revokeCurrentPushSubscription(
  context: PartnerContext,
  endpoint: string
) {
  if (context.membershipId === null) return { revoked: false };
  const db = await getV2Db();
  const now = new Date();
  await db
    .update(pushSubscriptions)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(pushSubscriptions.partnerId, context.partnerId),
        eq(pushSubscriptions.userId, context.userId),
        eq(pushSubscriptions.membershipId, context.membershipId),
        eq(pushSubscriptions.endpointHash, endpointHash(endpoint)),
        eq(pushSubscriptions.status, "active")
      )
    );
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "push_subscription_revoked",
    entityType: "push_subscription",
    entityId: endpointHash(endpoint).slice(0, 16),
    metadata: { source: "device_settings" },
  });
  return { revoked: true };
}

/** Used before logout: remove every tenant binding for this browser/account pair. */
export async function revokeBrowserPushSubscriptions(userId: number, endpoint: string) {
  const db = await getV2Db();
  const now = new Date();
  const hash = endpointHash(endpoint);
  const where = and(
    eq(pushSubscriptions.userId, userId),
    eq(pushSubscriptions.endpointHash, hash),
    eq(pushSubscriptions.status, "active")
  );
  const records = await db
    .select({ partnerId: pushSubscriptions.partnerId, membershipId: pushSubscriptions.membershipId })
    .from(pushSubscriptions)
    .where(where);
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx
      .update(pushSubscriptions)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(where);
    await Promise.all(
      records.map(record =>
        writeV2Audit(transactionDb, {
          partnerId: record.partnerId,
          actorUserId: userId,
          actorMembershipId: record.membershipId,
          action: "push_subscription_revoked",
          entityType: "push_subscription",
          entityId: hash.slice(0, 16),
          metadata: { source: "logout" },
        })
      )
    );
  });
  return { revoked: true };
}

/** Delivery code will call this after a provider reports an expired endpoint. */
export async function invalidatePushSubscription(subscriptionId: number) {
  const db = await getV2Db();
  const now = new Date();
  await db
    .update(pushSubscriptions)
    .set({ status: "invalid", invalidatedAt: now, updatedAt: now })
    .where(and(eq(pushSubscriptions.id, subscriptionId), eq(pushSubscriptions.status, "active")));
}

export function pushNotificationClientConfiguration() {
  return webPushPublicConfiguration();
}
