import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { getV2Db } from "./database";
import { dispatchFollowUpNotifications, type DispatchResult, type FollowUpPushTransport } from "./followUpNotificationDispatcher";
import { createFollowUpNotificationDispatcherRepository } from "./followUpNotificationDispatcherRepository";
import { createWebPushFollowUpTransport } from "./followUpNotificationWebPushTransport";
import { remoteHmlAutomaticPushTransportEnabled } from "./webPushConfig";

export const FOLLOW_UP_DISPATCH_PATH = "/internal/v2/follow-up-notifications/dispatch";
export const FOLLOW_UP_DISPATCH_MAX_BODY_BYTES = 128;
const FOLLOW_UP_DISPATCH_MAX_AGE_MS = 75_000;
const FOLLOW_UP_DISPATCH_BODY = '{"v":1}';

type TriggerEnvironment = Pick<NodeJS.ProcessEnv,
  "V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED" | "V2_FOLLOW_UP_DISPATCH_HMAC_SECRET" | "WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED"
>;

type TriggerDependencies = {
  environment?: TriggerEnvironment;
  now?: () => Date;
  dispatch?: () => Promise<DispatchResult>;
};

function canonicalRequest(timestamp: string, body: Buffer) {
  return `POST\n${FOLLOW_UP_DISPATCH_PATH}\n${timestamp}\n${body.toString("utf8")}`;
}

export function signFollowUpDispatchRequest(input: { secret: string; timestamp: string; body?: Buffer }) {
  return createHmac("sha256", input.secret)
    .update(canonicalRequest(input.timestamp, input.body ?? Buffer.from(FOLLOW_UP_DISPATCH_BODY)))
    .digest("hex");
}

export function verifyFollowUpDispatchRequest(input: {
  secret: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  body: Buffer;
  now: Date;
}) {
  if (!input.secret || !input.timestamp || !input.signature) return false;
  if (!/^\d{13}$/.test(input.timestamp) || !/^[a-f0-9]{64}$/i.test(input.signature)) return false;
  const timestampMs = Number(input.timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(input.now.getTime() - timestampMs) > FOLLOW_UP_DISPATCH_MAX_AGE_MS)
    return false;
  const expected = Buffer.from(signFollowUpDispatchRequest({ secret: input.secret, timestamp: input.timestamp, body: input.body }), "hex");
  const received = Buffer.from(input.signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Deliberately inert until a separately approved real provider adapter exists. */
export const inertFollowUpPushTransport: FollowUpPushTransport = {
  async send() { return { kind: "transient_failure" }; },
};

const activeRequests = new Set<string>();
const replayedRequests = new Map<string, number>();

function pruneReplayCache(now: number) {
  replayedRequests.forEach((expiresAt, key) => {
    if (expiresAt <= now) replayedRequests.delete(key);
  });
}

export function createFollowUpDispatchTriggerHandler(dependencies: TriggerDependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const dispatch = dependencies.dispatch ?? (async () => {
    const db = await getV2Db();
    return dispatchFollowUpNotifications({
      repository: createFollowUpNotificationDispatcherRepository(db),
      // Real delivery is impossible unless every independent HML identity gate
      // is configured. Production and unknown environments remain inert.
      transport: remoteHmlAutomaticPushTransportEnabled(environment)
        ? createWebPushFollowUpTransport(db, environment)
        : inertFollowUpPushTransport,
      environment,
      batchSize: 25,
    });
  });

  return async (req: Request, res: Response) => {
    if (environment.V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED !== "true") return res.sendStatus(404);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const current = now();
    if (
      body.length > FOLLOW_UP_DISPATCH_MAX_BODY_BYTES ||
      body.toString("utf8") !== FOLLOW_UP_DISPATCH_BODY ||
      !verifyFollowUpDispatchRequest({
        secret: environment.V2_FOLLOW_UP_DISPATCH_HMAC_SECRET,
        timestamp: req.header("x-fluxo-dispatch-timestamp") ?? undefined,
        signature: req.header("x-fluxo-dispatch-signature") ?? undefined,
        body,
        now: current,
      })
    ) return res.sendStatus(401);

    const replayKey = `${req.header("x-fluxo-dispatch-timestamp")}:${req.header("x-fluxo-dispatch-signature")}`;
    pruneReplayCache(current.getTime());
    if (replayedRequests.has(replayKey)) return res.sendStatus(409);
    if (activeRequests.has(FOLLOW_UP_DISPATCH_PATH)) return res.sendStatus(429);
    replayedRequests.set(replayKey, current.getTime() + FOLLOW_UP_DISPATCH_MAX_AGE_MS);
    activeRequests.add(FOLLOW_UP_DISPATCH_PATH);
    try {
      await dispatch();
      return res.status(202).json({ accepted: true });
    } catch {
      return res.sendStatus(503);
    } finally {
      activeRequests.delete(FOLLOW_UP_DISPATCH_PATH);
    }
  };
}
