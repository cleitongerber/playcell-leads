export type FollowUpDispatchWorkerEnvironment = {
  FLUXO_DISPATCH_URL: string;
  FLUXO_FOLLOW_UP_DISPATCH_HMAC_SECRET: string;
  FLUXO_HML_WORKER_ENABLED?: string;
  FLUXO_HML_SERVICE_ID?: string;
};

const BODY = '{"v":1}';
const HML_SERVICE_ID = "srv-dc1f8k142hec73a6tt10";
const HML_DISPATCH_URL = "https://fluxo-webpush-homologacao.onrender.com/internal/v2/follow-up-notifications/dispatch";

/** This Worker is intentionally incapable of calling any production URL. */
export function hmlWorkerEnabled(env: FollowUpDispatchWorkerEnvironment) {
  return (
    env.FLUXO_HML_WORKER_ENABLED === "true" &&
    env.FLUXO_HML_SERVICE_ID === HML_SERVICE_ID &&
    env.FLUXO_DISPATCH_URL === HML_DISPATCH_URL &&
    Boolean(env.FLUXO_FOLLOW_UP_DISPATCH_HMAC_SECRET)
  );
}

export function isOperationalFollowUpWindow(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const value = (kind: string) => parts.find(part => part.type === kind)?.value;
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdays[value("weekday") ?? ""] ?? -1;
  const minutes = Number(value("hour")) * 60 + Number(value("minute"));
  return weekday !== 0 && minutes >= 8 * 60 && minutes < (weekday === 6 ? 13 * 60 : 19 * 60);
}

async function signature(secret: string, timestamp: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const canonical = `POST\n/internal/v2/follow-up-notifications/dispatch\n${timestamp}\n${BODY}`;
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

export async function invokeFollowUpDispatch(env: FollowUpDispatchWorkerEnvironment, instant: Date, request = fetch) {
  if (!hmlWorkerEnabled(env)) return { invoked: false as const, reason: "hml_identity_not_confirmed" };
  if (!isOperationalFollowUpWindow(instant)) return { invoked: false as const, reason: "outside_operational_window" };
  const timestamp = String(instant.getTime());
  const response = await request(env.FLUXO_DISPATCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fluxo-dispatch-timestamp": timestamp,
      "x-fluxo-dispatch-signature": await signature(env.FLUXO_FOLLOW_UP_DISPATCH_HMAC_SECRET, timestamp),
    },
    body: BODY,
  });
  return { invoked: true as const, accepted: response.status === 202, status: response.status };
}

export default {
  async scheduled(controller: { scheduledTime: number }, env: FollowUpDispatchWorkerEnvironment) {
    await invokeFollowUpDispatch(env, new Date(controller.scheduledTime));
  },
};
