import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/v2/pushSubscriptionService.ts"),
  "utf8"
);
const router = readFileSync(resolve(process.cwd(), "server/v2/router.ts"), "utf8");

describe("push subscription authorization contract", () => {
  it("binds subscriptions to tenant, user and membership without persisting raw values", () => {
    expect(source).toContain("encryptPushSubscriptionValue(input.endpoint)");
    expect(source).toContain("encryptPushSubscriptionValue(encodedSubscription(input))");
    expect(source).toContain("eq(pushSubscriptions.partnerId, context.partnerId)");
    expect(source).toContain("eq(pushSubscriptions.userId, context.userId)");
    expect(source).toContain("eq(pushSubscriptions.membershipId, context.membershipId)");
    expect(source).toContain('action: "push_subscription_registered"');
    expect(source).not.toContain("metadata: { endpoint:");
  });

  it("uses protected procedures and does not grant management operational access", () => {
    expect(router).toContain("subscribe: v2OperationalProcedure");
    expect(router).toContain("revokeCurrent: v2OperationalProcedure");
    expect(router).toContain("revokeBrowserSession: v2ProtectedProcedure");
  });
});
