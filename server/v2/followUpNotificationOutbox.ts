import { and, eq, lt, sql } from "drizzle-orm";
import {
  followUpNotificationDeliveries,
  type FollowUpNotificationDeliveryStatus,
  type FollowUpNotificationStage,
} from "../../drizzle-v2/schema";
import type { V2Database } from "./database";
import {
  eligibleFollowUpNotificationStages,
  followUpNotificationAutomationEnabled,
  terminalFollowUpNotificationStatus,
} from "./followUpNotificationPolicy";

export type FollowUpNotificationDeliveryInput = {
  partnerId: number;
  followUpId: number;
  notificationVersion: number;
  stage: FollowUpNotificationStage;
  subscriptionId: number;
  scheduledFor: Date;
  eligibleUntil: Date;
};

function affectedRows(result: unknown) {
  return Number(
    (result as [{ affectedRows?: number }] | undefined)?.[0]?.affectedRows ?? 0
  );
}

/** The database unique key is the durable idempotency boundary for each device. */
export async function enqueueFollowUpNotificationDelivery(
  db: V2Database,
  input: FollowUpNotificationDeliveryInput
) {
  await db
    .insert(followUpNotificationDeliveries)
    .values({ ...input, status: "pending" })
    .onDuplicateKeyUpdate({
      // A duplicate must not reactivate, reschedule or otherwise mutate it.
      set: { id: sql`${followUpNotificationDeliveries.id}` },
    });
}

/**
 * Future schedulers must enter through this gate. The current codebase does
 * not invoke it, so the default-disabled flag cannot cause background work.
 */
export async function enqueueEligibleFollowUpNotificationDeliveries(
  db: V2Database,
  input: {
    partnerId: number;
    followUpId: number;
    notificationVersion: number;
    dueAt: Date;
    subscriptionIds: readonly number[];
    now: Date;
    timeZone?: string;
    partnerSettings?: { webPushFollowUpAutomationEnabled?: unknown } | null;
    environment?: NodeJS.ProcessEnv;
  }
) {
  if (
    !followUpNotificationAutomationEnabled(
      input.environment,
      input.partnerSettings
    )
  )
    return 0;
  const stages = eligibleFollowUpNotificationStages({
    dueAt: input.dueAt,
    now: input.now,
    timeZone: input.timeZone,
  });
  for (const stage of stages) {
    for (const subscriptionId of input.subscriptionIds) {
      await enqueueFollowUpNotificationDelivery(db, {
        partnerId: input.partnerId,
        followUpId: input.followUpId,
        notificationVersion: input.notificationVersion,
        subscriptionId,
        ...stage,
      });
    }
  }
  return stages.length * input.subscriptionIds.length;
}

/** Exactly one worker can change a pending row to sending for a claim token. */
export async function claimFollowUpNotificationDelivery(
  db: V2Database,
  input: { id: number; claimToken: string; now: Date }
) {
  const result = await db
    .update(followUpNotificationDeliveries)
    .set({
      status: "sending",
      claimToken: input.claimToken,
      claimedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(followUpNotificationDeliveries.id, input.id),
        eq(followUpNotificationDeliveries.status, "pending")
      )
    );
  return affectedRows(result) === 1;
}

/** A crash after a claim is terminally abandoned: V1 deliberately has no retry. */
export async function abandonExpiredFollowUpNotificationClaims(
  db: V2Database,
  olderThan: Date,
  now = new Date()
) {
  const result = await db
    .update(followUpNotificationDeliveries)
    .set({ status: "abandoned", processedAt: now, outcomeCode: "claim_expired", updatedAt: now })
    .where(
      and(
        eq(followUpNotificationDeliveries.status, "sending"),
        lt(followUpNotificationDeliveries.claimedAt, olderThan)
      )
    );
  return affectedRows(result);
}

export async function finishFollowUpNotificationDelivery(
  db: V2Database,
  input: {
    id: number;
    claimToken: string;
    status: Exclude<FollowUpNotificationDeliveryStatus, "pending" | "sending">;
    providerStatus?: number | null;
    outcomeCode: string;
    now: Date;
  }
) {
  if (!terminalFollowUpNotificationStatus(input.status))
    throw new Error("A entrega deve terminar em estado terminal");
  const result = await db
    .update(followUpNotificationDeliveries)
    .set({
      status: input.status,
      providerStatus: input.providerStatus ?? null,
      outcomeCode: input.outcomeCode,
      processedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(followUpNotificationDeliveries.id, input.id),
        eq(followUpNotificationDeliveries.status, "sending"),
        eq(followUpNotificationDeliveries.claimToken, input.claimToken)
      )
    );
  return affectedRows(result) === 1;
}
