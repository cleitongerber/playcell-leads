import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as webPush from "web-push";
import { describe, expect, it } from "vitest";
import { encryptPushSubscriptionValue } from "./pushSubscriptionCrypto";
import { createWebPushFollowUpTransport } from "./followUpNotificationWebPushTransport";

const source = readFileSync(resolve(process.cwd(), "server/v2/followUpNotificationWebPushTransport.ts"), "utf8");

describe("real follow-up Web Push transport contract", () => {
  it("decrypts only at the provider boundary and does not log sensitive subscription material", () => {
    expect(source).toContain('from "web-push"');
    expect(source).toContain("decryptPushSubscriptionValue");
    expect(source).toContain("configureWebPushDelivery");
    expect(source).toContain("status === 404 || status === 410");
    expect(source).not.toMatch(/console\.(log|error|warn)/);
    expect(source).not.toContain("writeV2Audit");
  });

  it("maps accepted, transient, and definitive provider results without exposing a subscription", async () => {
    const vapid = webPush.generateVAPIDKeys();
    const environment = {
      PUSH_SUBSCRIPTION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:hml@example.test",
    };
    const endpoint = "https://push.example.test/subscription";
    const row = {
      endpointCiphertext: encryptPushSubscriptionValue(endpoint, environment),
      keysCiphertext: encryptPushSubscriptionValue(JSON.stringify({
        endpoint,
        keys: { p256dh: "test-p256dh", auth: "test-auth" },
      }), environment),
    };
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    } as never;
    const payload = { title: "FLUXO", body: "Você tem um follow-up agendado.", path: "/v2/leads/1", tag: "fluxo-follow-up" } as const;
    const accepted = createWebPushFollowUpTransport(db, environment, async () => ({ statusCode: 201 }) as never);
    await expect(accepted.send({ deliveryId: 1, subscriptionId: 1, payload })).resolves.toEqual({ kind: "accepted", providerStatus: 201 });
    const gone = createWebPushFollowUpTransport(db, environment, async () => { throw { statusCode: 410 }; });
    await expect(gone.send({ deliveryId: 1, subscriptionId: 1, payload })).resolves.toEqual({ kind: "definitive_failure", providerStatus: 410 });
    const timeout = createWebPushFollowUpTransport(db, environment, async () => { throw new Error("timeout"); });
    await expect(timeout.send({ deliveryId: 1, subscriptionId: 1, payload })).resolves.toEqual({ kind: "transient_failure", providerStatus: null });
  });
});
