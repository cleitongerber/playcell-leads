import * as webPush from "web-push";
import { and, eq } from "drizzle-orm";
import { pushSubscriptions, type V2User } from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import { getV2Db } from "./database";
import { decryptPushSubscriptionValue } from "./pushSubscriptionCrypto";
import { writeV2Audit } from "./partnerService";
import { invalidatePushSubscription } from "./pushSubscriptionService";
import { configureWebPushDelivery } from "./webPushConfig";

const SYNTHETIC_SELLER_EMAIL = "vendedor1.demo@playcell.example";
const TEST_PAYLOAD = {
  title: "FLUXO",
  body: "Teste de avisos ativado com sucesso.",
  path: "/v2/follow-ups",
  tag: "fluxo-web-push-test",
} as const;

const activeTestDeliveries = new Set<string>();

export class PushTestDeliveryError extends Error {
  constructor(
    readonly reason: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "DELIVERY_FAILED"
  ) {
    super("Não foi possível executar o teste controlado de avisos.");
    this.name = "PushTestDeliveryError";
  }
}

function localDatabaseUrl(environment: NodeJS.ProcessEnv) {
  const value = environment.V2_DATABASE_URL;
  if (!value) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** This test send is intentionally impossible for deployed or non-local databases. */
export function allowsControlledPushTest(environment: NodeJS.ProcessEnv = process.env) {
  return (
    environment.WEB_PUSH_TEST_SEND_ENABLED === "true" &&
    environment.V2_ALLOW_LOCAL_HTTP_SESSION === "true" &&
    environment.NODE_ENV !== "production" &&
    localDatabaseUrl(environment)
  );
}

export function controlledPushTestPayload() {
  return TEST_PAYLOAD;
}

function providerStatus(error: unknown) {
  const value = error as { statusCode?: unknown };
  return typeof value?.statusCode === "number" ? value.statusCode : null;
}

function subscriptionFromRecord(record: {
  endpointCiphertext: string;
  keysCiphertext: string;
}) {
  const endpoint = decryptPushSubscriptionValue(record.endpointCiphertext);
  const decoded = JSON.parse(decryptPushSubscriptionValue(record.keysCiphertext)) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (
    decoded.endpoint !== endpoint ||
    typeof decoded.keys?.p256dh !== "string" ||
    typeof decoded.keys?.auth !== "string"
  ) {
    throw new PushTestDeliveryError("DELIVERY_FAILED");
  }
  return { endpoint, keys: { p256dh: decoded.keys.p256dh, auth: decoded.keys.auth } };
}

export async function sendControlledPushTest(
  context: PartnerContext,
  user: Pick<V2User, "email">,
  environment: NodeJS.ProcessEnv = process.env
) {
  if (
    !allowsControlledPushTest(environment) ||
    context.role !== "seller" ||
    context.membershipId === null ||
    user.email !== SYNTHETIC_SELLER_EMAIL
  ) {
    throw new PushTestDeliveryError("FORBIDDEN");
  }

  const slot = `${context.partnerId}:${context.membershipId}`;
  if (activeTestDeliveries.has(slot)) throw new PushTestDeliveryError("CONFLICT");
  activeTestDeliveries.add(slot);

  try {
    const db = await getV2Db();
    const records = await db
      .select({
        id: pushSubscriptions.id,
        endpointHash: pushSubscriptions.endpointHash,
        endpointCiphertext: pushSubscriptions.endpointCiphertext,
        keysCiphertext: pushSubscriptions.keysCiphertext,
      })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.partnerId, context.partnerId),
          eq(pushSubscriptions.userId, context.userId),
          eq(pushSubscriptions.membershipId, context.membershipId),
          eq(pushSubscriptions.status, "active")
        )
      )
      .limit(2);
    if (!records.length) throw new PushTestDeliveryError("NOT_FOUND");
    if (records.length > 1) throw new PushTestDeliveryError("CONFLICT");
    const record = records[0]!;
    const entityId = record.endpointHash.slice(0, 16);
    await writeV2Audit(db, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "push_test_delivery_attempted",
      entityType: "push_subscription",
      entityId,
      metadata: { payload: "fixed_follow_up_test" },
    });

    try {
      configureWebPushDelivery(environment);
      const response = await webPush.sendNotification(
        subscriptionFromRecord(record),
        JSON.stringify(TEST_PAYLOAD),
        { TTL: 60, urgency: "normal" }
      );
      await writeV2Audit(db, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "push_test_delivery_succeeded",
        entityType: "push_subscription",
        entityId,
        metadata: { providerStatus: response.statusCode },
      });
      return { delivered: true, providerStatus: response.statusCode };
    } catch (error) {
      const status = providerStatus(error);
      const invalidated = status === 404 || status === 410;
      if (invalidated) await invalidatePushSubscription(record.id);
      await writeV2Audit(db, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "push_test_delivery_failed",
        entityType: "push_subscription",
        entityId,
        metadata: {
          providerStatus: status,
          classification: invalidated ? "definitive" : "transient_or_unknown",
          invalidated,
        },
      });
      throw new PushTestDeliveryError("DELIVERY_FAILED");
    }
  } finally {
    activeTestDeliveries.delete(slot);
  }
}
