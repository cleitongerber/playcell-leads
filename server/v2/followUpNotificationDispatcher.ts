import { randomUUID } from "node:crypto";
import type { FollowUpNotificationStage } from "../../drizzle-v2/schema";
import {
  eligibleFollowUpNotificationStages,
  followUpNotificationAutomationEnabled,
} from "./followUpNotificationPolicy";

export type FollowUpPushPayload = {
  title: "FLUXO";
  body: "Você tem um follow-up agendado.";
  path: string;
  tag: "fluxo-follow-up";
};

export type DispatchCandidate = {
  partnerId: number;
  followUpId: number;
  notificationVersion: number;
  dueAt: Date;
  leadId: number;
  subscriptionIds: readonly number[];
  partnerSettings: { webPushFollowUpAutomationEnabled?: unknown } | null;
};

export type PendingDelivery = {
  id: number;
  partnerId: number;
  followUpId: number;
  notificationVersion: number;
  stage: FollowUpNotificationStage;
  subscriptionId: number;
};

export type DeliveryRevalidation =
  | {
      eligible: true;
      leadId: number;
      actorUserId: number;
      actorMembershipId: number;
      partnerSettings: { webPushFollowUpAutomationEnabled?: unknown } | null;
    }
  | { eligible: false; reason: string };

export type PushTransportResult =
  | { kind: "accepted"; providerStatus: number }
  | { kind: "definitive_failure"; providerStatus: 404 | 410 }
  | { kind: "transient_failure"; providerStatus?: number | null }
  | { kind: "timeout" };

/** This contract intentionally excludes endpoint and key material. */
export type FollowUpPushTransport = {
  send(input: { deliveryId: number; subscriptionId: number; payload: FollowUpPushPayload }): Promise<PushTransportResult>;
};

/**
 * The future database adapter owns all joins. A false result means a confirmed
 * business/security ineligibility; rejection/throw means it could not verify.
 */
export type FollowUpNotificationDispatcherRepository = {
  listDispatchCandidates(input: { now: Date; batchSize: number }): Promise<DispatchCandidate[]>;
  enqueue(input: DispatchCandidate & { stage: FollowUpNotificationStage; scheduledFor: Date; eligibleUntil: Date; subscriptionId: number }): Promise<void>;
  listPendingDeliveries(input: { now: Date; batchSize: number }): Promise<PendingDelivery[]>;
  claim(input: { id: number; claimToken: string; now: Date }): Promise<boolean>;
  revalidate(input: { delivery: PendingDelivery; now: Date }): Promise<DeliveryRevalidation>;
  finish(input: { id: number; claimToken: string; status: "sent" | "failed" | "invalid" | "suppressed"; providerStatus?: number | null; outcomeCode: string; now: Date }): Promise<boolean>;
  invalidateSubscription(input: { subscriptionId: number; now: Date }): Promise<void>;
  audit(input: { partnerId: number; actorUserId: number; actorMembershipId: number; action: string; deliveryId: number; metadata: Record<string, string | number | boolean | null> }): Promise<void>;
};

export type DispatchResult = {
  planned: number;
  claimed: number;
  sent: number;
  failed: number;
  invalid: number;
  suppressed: number;
  skippedByFlag: boolean;
};

export function followUpPushPayload(leadId: number): FollowUpPushPayload {
  return {
    title: "FLUXO",
    body: "Você tem um follow-up agendado.",
    path: `/v2/leads/${leadId}`,
    tag: "fluxo-follow-up",
  };
}

/**
 * Single-run dispatcher only. It has no HTTP route, timer, provider import or
 * database connection lifecycle; a future CLI/cron must inject those safely.
 */
export async function dispatchFollowUpNotifications(input: {
  repository: FollowUpNotificationDispatcherRepository;
  transport: FollowUpPushTransport;
  now?: Date;
  batchSize?: number;
  environment?: NodeJS.ProcessEnv;
}): Promise<DispatchResult> {
  const now = input.now ?? new Date();
  const batchSize = Math.min(Math.max(input.batchSize ?? 25, 1), 100);
  const result: DispatchResult = {
    planned: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    invalid: 0,
    suppressed: 0,
    skippedByFlag: false,
  };
  const candidates = await input.repository.listDispatchCandidates({ now, batchSize });
  for (const candidate of candidates) {
    if (!followUpNotificationAutomationEnabled(input.environment, candidate.partnerSettings)) {
      result.skippedByFlag = true;
      continue;
    }
    for (const stage of eligibleFollowUpNotificationStages({ dueAt: candidate.dueAt, now })) {
      for (const subscriptionId of candidate.subscriptionIds) {
        await input.repository.enqueue({ ...candidate, ...stage, subscriptionId });
        result.planned += 1;
      }
    }
  }

  const deliveries = await input.repository.listPendingDeliveries({ now, batchSize });
  for (const delivery of deliveries) {
    const claimToken = randomUUID();
    if (!(await input.repository.claim({ id: delivery.id, claimToken, now }))) continue;
    result.claimed += 1;
    let revalidation: DeliveryRevalidation;
    try {
      revalidation = await input.repository.revalidate({ delivery, now });
    } catch {
      await input.repository.finish({
        id: delivery.id, claimToken, status: "failed", outcomeCode: "revalidation_unavailable", now,
      });
      result.failed += 1;
      continue;
    }
    if (!revalidation.eligible) {
      await input.repository.finish({
        id: delivery.id, claimToken, status: "suppressed", outcomeCode: revalidation.reason, now,
      });
      result.suppressed += 1;
      continue;
    }
    // Flags are checked again immediately before the transport boundary.
    let latest: DeliveryRevalidation;
    try {
      latest = await input.repository.revalidate({ delivery, now });
    } catch {
      await input.repository.finish({
        id: delivery.id, claimToken, status: "failed", outcomeCode: "revalidation_unavailable", now,
      });
      result.failed += 1;
      continue;
    }
    if (
      !latest.eligible ||
      !followUpNotificationAutomationEnabled(input.environment, latest.partnerSettings)
    ) {
      await input.repository.finish({
        id: delivery.id,
        claimToken,
        status: "suppressed",
        outcomeCode: latest.eligible ? "automation_disabled" : latest.reason,
        now,
      });
      result.suppressed += 1;
      continue;
    }
    let transportResult: PushTransportResult;
    try {
      transportResult = await input.transport.send({
        deliveryId: delivery.id,
        subscriptionId: delivery.subscriptionId,
        payload: followUpPushPayload(latest.leadId),
      });
    } catch {
      transportResult = { kind: "transient_failure" };
    }
    const outcome =
      transportResult.kind === "accepted"
        ? { status: "sent" as const, code: "provider_accepted", providerStatus: transportResult.providerStatus }
        : transportResult.kind === "definitive_failure"
          ? { status: "invalid" as const, code: "provider_subscription_invalid", providerStatus: transportResult.providerStatus }
          : { status: "failed" as const, code: transportResult.kind === "timeout" ? "transport_timeout" : "transport_transient_failure", providerStatus: transportResult.kind === "transient_failure" ? transportResult.providerStatus ?? null : null };
    if (outcome.status === "invalid")
      await input.repository.invalidateSubscription({ subscriptionId: delivery.subscriptionId, now });
    await input.repository.finish({
      id: delivery.id,
      claimToken,
      status: outcome.status,
      providerStatus: outcome.providerStatus,
      outcomeCode: outcome.code,
      now,
    });
    await input.repository.audit({
      partnerId: delivery.partnerId,
      actorUserId: latest.actorUserId,
      actorMembershipId: latest.actorMembershipId,
      action: `follow_up_push_${outcome.status}`,
      deliveryId: delivery.id,
      metadata: { stage: delivery.stage, providerStatus: outcome.providerStatus ?? null, outcome: outcome.code },
    });
    if (outcome.status === "sent") result.sent += 1;
    else if (outcome.status === "invalid") result.invalid += 1;
    else result.failed += 1;
  }
  return result;
}
