import * as webPush from "web-push";
import { eq } from "drizzle-orm";
import { pushSubscriptions } from "../../drizzle-v2/schema";
import type {
  FollowUpPushTransport,
  PushTransportResult,
} from "./followUpNotificationDispatcher";
import type { V2Database } from "./database";
import { decryptPushSubscriptionValue } from "./pushSubscriptionCrypto";
import { configureWebPushDelivery } from "./webPushConfig";

function providerStatus(error: unknown) {
  const value = error as { statusCode?: unknown };
  return typeof value?.statusCode === "number" ? value.statusCode : null;
}

/**
 * Reads the encrypted subscription only at the provider boundary. Neither the
 * outbox nor dispatcher logs contain the endpoint or browser keys.
 */
export async function readFollowUpPushSubscription(
  db: V2Database,
  subscriptionId: number,
  environment: NodeJS.ProcessEnv = process.env
) {
  const row = (await db
    .select({
      endpointCiphertext: pushSubscriptions.endpointCiphertext,
      keysCiphertext: pushSubscriptions.keysCiphertext,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subscriptionId))
    .limit(1))[0];
  if (!row) throw new Error("subscription_not_found");
  const endpoint = decryptPushSubscriptionValue(row.endpointCiphertext, environment);
  const decoded = JSON.parse(decryptPushSubscriptionValue(row.keysCiphertext, environment)) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (
    decoded.endpoint !== endpoint ||
    typeof decoded.keys?.p256dh !== "string" ||
    typeof decoded.keys?.auth !== "string"
  ) throw new Error("subscription_invalid");
  return { endpoint, keys: { p256dh: decoded.keys.p256dh, auth: decoded.keys.auth } };
}

/** A real provider adapter, injected only after the HML identity gate passes. */
export function createWebPushFollowUpTransport(
  db: V2Database,
  environment: NodeJS.ProcessEnv = process.env,
  sender: typeof webPush.sendNotification = webPush.sendNotification
): FollowUpPushTransport {
  return {
    async send(input): Promise<PushTransportResult> {
      try {
        configureWebPushDelivery(environment);
        const subscription = await readFollowUpPushSubscription(db, input.subscriptionId, environment);
        const response = await sender(subscription, JSON.stringify(input.payload), {
          TTL: 60,
          urgency: "normal",
        });
        return { kind: "accepted", providerStatus: response.statusCode };
      } catch (error) {
        const status = providerStatus(error);
        if (status === 404 || status === 410)
          return { kind: "definitive_failure", providerStatus: status };
        return { kind: "transient_failure", providerStatus: status };
      }
    },
  };
}
