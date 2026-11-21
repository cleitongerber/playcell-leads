import { describe, expect, it } from "vitest";
import * as webPush from "web-push";
import {
  PushSubscriptionConfigurationError,
  decryptPushSubscriptionValue,
  encryptPushSubscriptionValue,
  hashPushSubscriptionValue,
} from "./pushSubscriptionCrypto";
import { webPushPublicConfiguration } from "./webPushConfig";
import { configureWebPushDelivery } from "./webPushConfig";

const environment = {
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
};

describe("push subscription protection", () => {
  it("encrypts browser endpoints at rest while keeping a stable lookup hash", () => {
    const value = "https://push.example.test/subscription";
    const encrypted = encryptPushSubscriptionValue(value, environment);
    expect(encrypted).not.toContain(value);
    expect(decryptPushSubscriptionValue(encrypted, environment)).toBe(value);
    expect(hashPushSubscriptionValue(value)).toHaveLength(64);
    expect(hashPushSubscriptionValue(value)).toBe(hashPushSubscriptionValue(value));
  });

  it("rejects absent or invalid encryption keys", () => {
    expect(() => encryptPushSubscriptionValue("x", {})).toThrow(
      PushSubscriptionConfigurationError
    );
    expect(() => encryptPushSubscriptionValue("x", { PUSH_SUBSCRIPTION_ENCRYPTION_KEY: "short" })).toThrow(
      PushSubscriptionConfigurationError
    );
  });

  it("exposes only the VAPID public key to browser configuration", () => {
    expect(
      webPushPublicConfiguration({
        VAPID_PUBLIC_KEY: "public-key",
        VAPID_PRIVATE_KEY: "private-key",
        VAPID_SUBJECT: "mailto:security@example.test",
      })
    ).toEqual({ enabled: true, publicKey: "public-key", controlledTestEnabled: false });
  });

  it("accepts VAPID configuration through the CommonJS-compatible server module", () => {
    const vapid = webPush.generateVAPIDKeys();
    expect(
      configureWebPushDelivery({
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: "mailto:security@example.test",
      })
    ).toEqual(expect.objectContaining({ subject: "mailto:security@example.test" }));
  });
});
