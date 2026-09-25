import { describe, expect, it } from "vitest";
import {
  isV2NavigationActive,
  visibleV2Navigation,
} from "./v2Navigation";

describe("V2 navigation", () => {
  it("does not expose administration to sellers", () => {
    expect(visibleV2Navigation("seller").map(item => item.key)).toEqual([
      "dashboard",
      "leads",
      "followUps",
      "campaigns",
      "productivity",
      "reports",
    ]);
  });

  it("exposes partner administration only to operational administrators", () => {
    expect(visibleV2Navigation("partner_admin").map(item => item.key)).toContain(
      "administration"
    );
    expect(visibleV2Navigation("manager").map(item => item.key)).not.toContain(
      "governance"
    );
  });

  it("keeps nested routes attached to their primary destination", () => {
    expect(isV2NavigationActive("/v2/leads", "/v2/leads/42")).toBe(true);
    expect(isV2NavigationActive("/v2/campaigns", "/v2/campaigns/8/imports")).toBe(true);
    expect(isV2NavigationActive("/v2/reports", "/v2/dashboard")).toBe(false);
  });
});
