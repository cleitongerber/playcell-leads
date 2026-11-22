import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/v2/followUpNotificationDispatcherRepository.ts"),
  "utf8"
);
const dispatcher = readFileSync(
  resolve(process.cwd(), "server/v2/followUpNotificationDispatcher.ts"),
  "utf8"
);

describe("follow-up notification dispatcher security contract", () => {
  it("revalidates tenant, owner, active seller, PDV scope and subscription binding", () => {
    for (const evidence of [
      "JSON.parse(value)",
      "row.deliveryVersion !== row.followUpVersion",
      "row.followUpOwner !== row.leadOwner",
      'row.membershipRole !== "seller"',
      "sellerHasPdvScope",
      "row.subscriptionPartnerId !== row.deliveryPartnerId",
      "row.subscriptionUserId !== row.userId",
      "row.subscriptionMembershipId !== row.membershipId",
      'row.subscriptionStatus !== "active"',
    ]) expect(source).toContain(evidence);
  });

  it("keeps this stage detached from the real Web Push provider and public routes", () => {
    expect(dispatcher).not.toContain('from "web-push"');
    expect(dispatcher).not.toContain("sendNotification");
    expect(dispatcher).not.toContain("router");
    expect(source).not.toContain("endpointCiphertext");
    expect(source).not.toContain("keysCiphertext");
  });

  it("records only sanitized delivery outcome metadata", () => {
    expect(source).toContain('entityType: "follow_up_notification_delivery"');
    expect(dispatcher).toContain("providerStatus");
    expect(dispatcher).not.toContain("phone");
    expect(dispatcher).not.toContain("cpf");
  });
});
