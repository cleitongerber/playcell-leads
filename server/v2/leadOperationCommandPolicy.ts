import type { LeadOperationCommandStatus } from "../../drizzle-v2/schema";

/** Describes how a future command handler must treat a duplicate request key. */
export function commandReplayDisposition(status: LeadOperationCommandStatus) {
  switch (status) {
    case "completed":
      return "return_completed" as const;
    case "processing":
      return "return_processing" as const;
    case "failed":
      return "return_failed" as const;
  }
}

export function assertOperationRequestKey(requestKey: string) {
  const normalized = requestKey.trim();
  if (!normalized || normalized.length > 96) {
    throw new Error("Chave de idempotência inválida");
  }
  return normalized;
}
