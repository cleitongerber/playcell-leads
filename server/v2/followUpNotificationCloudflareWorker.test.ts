import { describe, expect, it, vi } from "vitest";
import { hmlWorkerEnabled, invokeFollowUpDispatch, isOperationalFollowUpWindow } from "../../cloudflare/follow-up-dispatch-worker";

const env = {
  FLUXO_DISPATCH_URL: "https://fluxo-webpush-homologacao.onrender.com/internal/v2/follow-up-notifications/dispatch",
  FLUXO_FOLLOW_UP_DISPATCH_HMAC_SECRET: "test-only-secret",
  FLUXO_HML_WORKER_ENABLED: "true",
  FLUXO_HML_SERVICE_ID: "srv-dc1f8k142hec73a6tt10",
};

describe("follow-up dispatch Cloudflare worker", () => {
  it("uses the Sao Paulo inclusive/exclusive operating window", () => {
    expect(isOperationalFollowUpWindow(new Date("2026-11-23T11:00:00Z"))).toBe(true); // 08:00 Monday
    expect(isOperationalFollowUpWindow(new Date("2026-11-23T22:00:00Z"))).toBe(false); // 19:00 Monday
    expect(isOperationalFollowUpWindow(new Date("2026-11-21T16:00:00Z"))).toBe(false); // 13:00 Saturday
    expect(isOperationalFollowUpWindow(new Date("2026-11-21T15:59:00Z"))).toBe(true);
    expect(isOperationalFollowUpWindow(new Date("2026-11-22T15:00:00Z"))).toBe(false);
  });

  it("does not call Render outside the window and signs one in-window POST", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(invokeFollowUpDispatch(env, new Date("2026-11-22T15:00:00Z"), request)).resolves.toMatchObject({ invoked: false });
    expect(request).not.toHaveBeenCalled();
    await expect(invokeFollowUpDispatch(env, new Date("2026-11-23T13:00:00Z"), request)).resolves.toMatchObject({ invoked: true, accepted: true, status: 202 });
    expect(request).toHaveBeenCalledWith(env.FLUXO_DISPATCH_URL, expect.objectContaining({ method: "POST", body: '{"v":1}' }));
    expect(request.mock.calls[0][1].headers["x-fluxo-dispatch-signature"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not retry a timeout or backend failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("network timeout"));
    await expect(invokeFollowUpDispatch(env, new Date("2026-11-23T13:00:00Z"), request)).rejects.toThrow("network timeout");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fails closed for disabled, unknown, and production-shaped destinations", async () => {
    expect(hmlWorkerEnabled({ ...env, FLUXO_HML_WORKER_ENABLED: "false" })).toBe(false);
    expect(hmlWorkerEnabled({ ...env, FLUXO_HML_SERVICE_ID: "srv-other" })).toBe(false);
    expect(hmlWorkerEnabled({ ...env, FLUXO_DISPATCH_URL: "https://playcell-leads.onrender.com/internal/v2/follow-up-notifications/dispatch" })).toBe(false);
    const request = vi.fn();
    await expect(invokeFollowUpDispatch({ ...env, FLUXO_DISPATCH_URL: "https://playcell-leads.onrender.com/internal/v2/follow-up-notifications/dispatch" }, new Date("2026-11-23T13:00:00Z"), request)).resolves.toMatchObject({ invoked: false, reason: "hml_identity_not_confirmed" });
    expect(request).not.toHaveBeenCalled();
  });
});
