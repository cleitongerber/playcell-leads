import { describe, expect, it } from "vitest";
import {
  dispatchFollowUpNotifications,
  followUpPushPayload,
  type DeliveryRevalidation,
  type DispatchCandidate,
  type FollowUpNotificationDispatcherRepository,
  type FollowUpPushTransport,
  type PendingDelivery,
  type PushTransportResult,
} from "./followUpNotificationDispatcher";

const now = new Date("2026-11-23T14:00:00.000Z");
const enabledEnvironment = { WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "true" };
const enabledSettings = { webPushFollowUpAutomationEnabled: true };

function candidate(overrides: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    partnerId: 1,
    followUpId: 10,
    notificationVersion: 1,
    dueAt: now,
    leadId: 99,
    subscriptionIds: [501],
    partnerSettings: enabledSettings,
    ...overrides,
  };
}

class MemoryRepository implements FollowUpNotificationDispatcherRepository {
  deliveries: PendingDelivery[] = [];
  final = new Map<number, string>();
  invalidated: number[] = [];
  audits: Array<Record<string, unknown>> = [];
  candidates: DispatchCandidate[];
  revalidation: DeliveryRevalidation;
  failRevalidation = false;
  claimed = new Set<number>();
  constructor(input: { candidates?: DispatchCandidate[]; revalidation?: DeliveryRevalidation } = {}) {
    this.candidates = input.candidates ?? [candidate()];
    this.revalidation = input.revalidation ?? {
      eligible: true,
      leadId: 99,
      actorUserId: 7,
      actorMembershipId: 8,
      partnerSettings: enabledSettings,
    };
  }
  async listDispatchCandidates() { return this.candidates; }
  async enqueue(input: DispatchCandidate & { stage: PendingDelivery["stage"]; subscriptionId: number }) {
    if (this.deliveries.some(item => item.followUpId === input.followUpId && item.notificationVersion === input.notificationVersion && item.stage === input.stage && item.subscriptionId === input.subscriptionId)) return;
    this.deliveries.push({ id: this.deliveries.length + 1, partnerId: input.partnerId, followUpId: input.followUpId, notificationVersion: input.notificationVersion, stage: input.stage, subscriptionId: input.subscriptionId });
  }
  async listPendingDeliveries() { return this.deliveries.filter(item => !this.final.has(item.id)); }
  async claim(input: { id: number }) { if (this.claimed.has(input.id)) return false; this.claimed.add(input.id); return true; }
  async revalidate() { if (this.failRevalidation) throw new Error("database timeout"); return this.revalidation; }
  async finish(input: { id: number; status: string; outcomeCode: string }) { this.final.set(input.id, `${input.status}:${input.outcomeCode}`); return true; }
  async invalidateSubscription(input: { subscriptionId: number }) { this.invalidated.push(input.subscriptionId); }
  async audit(input: { metadata: Record<string, string | number | boolean | null>; action: string; deliveryId: number }) { this.audits.push(input); }
}

function transport(result: PushTransportResult): FollowUpPushTransport {
  return { send: async () => result };
}

describe("follow-up notification dispatcher", () => {
  it("plans one DUE delivery for every active device and persists generic results", async () => {
    const repository = new MemoryRepository({ candidates: [candidate({ subscriptionIds: [501, 502] })] });
    const result = await dispatchFollowUpNotifications({ repository, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment });
    expect(result).toMatchObject({ planned: 2, claimed: 2, sent: 2, failed: 0 });
    expect(repository.final.size).toBe(2);
    expect(repository.audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "follow_up_push_sent" })]));
  });

  it("fails closed when either automation flag is disabled, including after enqueue", async () => {
    const disabled = new MemoryRepository({ candidates: [candidate({ partnerSettings: null })] });
    const first = await dispatchFollowUpNotifications({ repository: disabled, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment });
    expect(first).toMatchObject({ planned: 0, claimed: 0, skippedByFlag: true });

    const changed = new MemoryRepository();
    let checks = 0;
    changed.revalidate = async () => ({
      eligible: true as const,
      leadId: 99,
      actorUserId: 7,
      actorMembershipId: 8,
      partnerSettings: ++checks === 1 ? enabledSettings : null,
    });
    const second = await dispatchFollowUpNotifications({ repository: changed, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment });
    expect(second).toMatchObject({ suppressed: 1, sent: 0 });
  });

  it("suppresses completed, cancelled, reassigned, rescheduled and ineligible records before transport", async () => {
    for (const reason of ["follow_up_completed", "follow_up_cancelled", "notification_version_stale", "follow_up_rescheduled", "campaign_inactive", "lead_terminal", "membership_inactive", "subscription_inactive", "pdv_scope_invalid", "partner_mismatch"]) {
      const repository = new MemoryRepository({ revalidation: { eligible: false, reason } });
      const result = await dispatchFollowUpNotifications({ repository, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment });
      expect(result.suppressed).toBe(1);
      expect(repository.final.get(1)).toBe(`suppressed:${reason}`);
    }
  });

  it("allows only one concurrent dispatcher to claim a delivery", async () => {
    const repository = new MemoryRepository();
    const [first, second] = await Promise.all([
      dispatchFollowUpNotifications({ repository, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment }),
      dispatchFollowUpNotifications({ repository, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment }),
    ]);
    expect(first.sent + second.sent).toBe(1);
    expect(repository.deliveries).toHaveLength(1);
  });

  it("maps provider success, timeout, transient and definitive failures without retry", async () => {
    const cases: Array<[PushTransportResult, string, number]> = [
      [{ kind: "accepted", providerStatus: 201 }, "sent:provider_accepted", 0],
      [{ kind: "timeout" }, "failed:transport_timeout", 0],
      [{ kind: "transient_failure", providerStatus: 503 }, "failed:transport_transient_failure", 0],
      [{ kind: "definitive_failure", providerStatus: 410 }, "invalid:provider_subscription_invalid", 1],
    ];
    for (const [providerResult, expected, invalidated] of cases) {
      const repository = new MemoryRepository();
      await dispatchFollowUpNotifications({ repository, transport: transport(providerResult), now, environment: enabledEnvironment });
      expect(repository.final.get(1)).toBe(expected);
      expect(repository.invalidated).toHaveLength(invalidated);
    }
  });

  it("treats database verification failure as failed, not commercial ineligibility", async () => {
    const repository = new MemoryRepository();
    repository.failRevalidation = true;
    const result = await dispatchFollowUpNotifications({ repository, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment });
    expect(result).toMatchObject({ failed: 1, suppressed: 0 });
    expect(repository.final.get(1)).toBe("failed:revalidation_unavailable");
  });

  it("also fails closed when the final pre-transport revalidation times out", async () => {
    const repository = new MemoryRepository();
    let checks = 0;
    repository.revalidate = async () => {
      if (++checks === 2) throw new Error("database timeout");
      return {
        eligible: true,
        leadId: 99,
        actorUserId: 7,
        actorMembershipId: 8,
        partnerSettings: enabledSettings,
      };
    };
    const result = await dispatchFollowUpNotifications({ repository, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment });
    expect(result).toMatchObject({ failed: 1, sent: 0, suppressed: 0 });
    expect(repository.final.get(1)).toBe("failed:revalidation_unavailable");
  });

  it("keeps the payload and audit free of PII and uses an authorized internal lead path", async () => {
    expect(followUpPushPayload(123)).toEqual({ title: "FLUXO", body: "Você tem um follow-up agendado.", path: "/v2/leads/123", tag: "fluxo-follow-up" });
    const repository = new MemoryRepository();
    await dispatchFollowUpNotifications({ repository, transport: transport({ kind: "accepted", providerStatus: 201 }), now, environment: enabledEnvironment });
    expect(JSON.stringify(repository.audits)).not.toMatch(/telefone|cpf|endpoint|observa|cliente/i);
  });
});
