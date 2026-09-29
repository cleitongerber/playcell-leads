import { describe, expect, it } from "vitest";
import {
  assertOperationRequestKey,
  commandReplayDisposition,
} from "./leadOperationCommandPolicy";

describe("lead operation command idempotency policy", () => {
  it("normalizes a request key and rejects absent or oversized keys", () => {
    expect(assertOperationRequestKey(" request-123 ")).toBe("request-123");
    expect(() => assertOperationRequestKey(" ")).toThrow("idempotência");
    expect(() => assertOperationRequestKey("short")).toThrow("idempotência");
    expect(() => assertOperationRequestKey("x".repeat(97))).toThrow(
      "idempotência"
    );
  });

  it("returns an existing command outcome instead of asking a future handler to repeat it", () => {
    expect(commandReplayDisposition("processing")).toBe("return_processing");
    expect(commandReplayDisposition("completed")).toBe("return_completed");
    expect(commandReplayDisposition("failed")).toBe("return_failed");
  });
});
