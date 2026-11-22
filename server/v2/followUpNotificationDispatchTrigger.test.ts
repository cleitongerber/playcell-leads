import { describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { createFollowUpDispatchTriggerHandler, signFollowUpDispatchRequest } from "./followUpNotificationDispatchTrigger";

const secret = "synthetic-test-secret-only";
const timestamp = "1763989200000";
const body = Buffer.from('{"v":1}');
const environment = {
  V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED: "true",
  V2_FOLLOW_UP_DISPATCH_HMAC_SECRET: secret,
  WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED: "true",
} as const;

function request(overrides: Record<string, unknown> = {}, requestTimestamp = timestamp) {
  const headers = {
    "x-fluxo-dispatch-timestamp": requestTimestamp,
    "x-fluxo-dispatch-signature": signFollowUpDispatchRequest({ secret, timestamp: requestTimestamp, body }),
  };
  return { body, header: (name: string) => headers[name as keyof typeof headers], ...overrides } as never;
}

function responseStub() {
  const value = { statusCode: 0, body: undefined as unknown };
  return {
    value,
    response: {
      sendStatus: vi.fn((status: number) => { value.statusCode = status; }),
      status: vi.fn((status: number) => ({ json: (body: unknown) => { value.statusCode = status; value.body = body; } })),
    } as never,
  };
}

describe("authenticated follow-up dispatch trigger", () => {
  const now = () => new Date(Number(timestamp));

  it("accepts one valid canonical HMAC request without exposing dispatch details", async () => {
    const dispatch = vi.fn().mockResolvedValue({});
    const handler = createFollowUpDispatchTriggerHandler({ environment, now, dispatch });
    const { response, value } = responseStub();
    await handler(request({}, "1763989200000"), response);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(value).toEqual({ statusCode: 202, body: { accepted: true } });
  });

  it("rejects invalid, stale, altered and replayed requests", async () => {
    const dispatch = vi.fn().mockResolvedValue({});
    const handler = createFollowUpDispatchTriggerHandler({ environment, now, dispatch });
    const uniqueTimestamp = "1763989200001";
    for (const invalid of [
      request({ header: () => undefined }, uniqueTimestamp),
      request({ header: (name: string) => name.includes("signature") ? "0".repeat(64) : uniqueTimestamp }, uniqueTimestamp),
      request({ header: (name: string) => name.includes("timestamp") ? "1763989000000" : signFollowUpDispatchRequest({ secret, timestamp: uniqueTimestamp, body }) }, uniqueTimestamp),
      request({ body: Buffer.from('{"v":2}') }),
    ]) {
      const { response, value } = responseStub();
      await handler(invalid, response);
      expect(value.statusCode).toBe(401);
    }
    const first = responseStub();
    await handler(request({}, uniqueTimestamp), first.response);
    const repeated = responseStub();
    await handler(request({}, uniqueTimestamp), repeated.response);
    expect(repeated.value.statusCode).toBe(409);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("fails closed when disabled and serializes simultaneous invocations", async () => {
    const disabled = createFollowUpDispatchTriggerHandler({ environment: { ...environment, V2_FOLLOW_UP_DISPATCH_HTTP_ENABLED: "false" }, now, dispatch: vi.fn() });
    const off = responseStub();
    await disabled(request(), off.response);
    expect(off.value.statusCode).toBe(404);

    let resolve!: () => void;
    const dispatch = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const handler = createFollowUpDispatchTriggerHandler({ environment, now, dispatch });
    const first = responseStub();
    const firstTimestamp = "1763989200002";
    const running = handler(request({}, firstTimestamp), first.response);
    const second = responseStub();
    await handler(request({}, "1763989200003"), second.response);
    expect(second.value.statusCode).toBe(429);
    resolve();
    await running;
  });
});
