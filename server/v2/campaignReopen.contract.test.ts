import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve(process.cwd(), "server/v2/campaignService.ts"),
  "utf8"
);
const router = readFileSync(resolve(process.cwd(), "server/v2/router.ts"), "utf8");

describe("campaign reopen contract", () => {
  it("uses an admin-only explicit closed-to-active transition with an audit event", () => {
    const start = service.indexOf("export async function reopenCampaign");
    const body = service.slice(start, service.indexOf("export async function setCampaignFrozen", start));
    expect(body).toContain("requirePdvAdministration(context)");
    expect(body).toContain("assertCampaignReopen(current.status)");
    expect(body).toContain('set({ status: "active", updatedAt: new Date() })');
    expect(body).toContain('eq(campaigns.status, "closed")');
    expect(body).toContain('action: "campaign_reopened"');
    expect(body).toContain("remainedFrozen: current.isFrozen");
  });

  it("exposes reopening only through the partner-admin procedure", () => {
    const campaigns = router.slice(router.indexOf("campaigns: v2Router"), router.indexOf("leads: v2Router"));
    expect(campaigns).toContain("reopen: v2PartnerAdminProcedure");
    expect(campaigns).toContain("reopenCampaign(ctx.partner, input.id)");
  });
});
