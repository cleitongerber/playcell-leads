import type {
  FollowUpPushTransport,
  PushTransportResult,
} from "./followUpNotificationDispatcher";

export type SyntheticPushOutcome = "accepted" | "transient" | "timeout" | "gone" | "not_found";

/** Test-only transport. It intentionally has no provider, endpoint or VAPID dependency. */
export function createSyntheticFollowUpPushTransport(
  outcome: SyntheticPushOutcome
): FollowUpPushTransport {
  const result: PushTransportResult =
    outcome === "accepted"
      ? { kind: "accepted", providerStatus: 201 }
      : outcome === "gone"
        ? { kind: "definitive_failure", providerStatus: 410 }
        : outcome === "not_found"
          ? { kind: "definitive_failure", providerStatus: 404 }
          : outcome === "timeout"
            ? { kind: "timeout" }
            : { kind: "transient_failure", providerStatus: 503 };
  return { send: async () => result };
}
