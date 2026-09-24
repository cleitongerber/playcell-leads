import { describe, expect, it } from "vitest";
import { PartnerAccessError, type PartnerContext } from "./access";
import { assertCampaignTransition, canFreezeCampaign, canViewCampaignByPdvScope, normalizeCampaignCode } from "./campaignDomain";

const adminA: PartnerContext = { userId: 1, partnerId: 10, membershipId: 101, role: "partner_admin" };
const managerA: PartnerContext = { userId: 2, partnerId: 10, membershipId: 102, role: "manager" };
const sellerA: PartnerContext = { userId: 3, partnerId: 10, membershipId: 103, role: "seller" };

describe("Campaign V2 domain and scope", () => {
  it("accepts only the explicit campaign lifecycle", () => {
    expect(() => assertCampaignTransition("draft", "active")).not.toThrow();
    expect(() => assertCampaignTransition("active", "closed")).not.toThrow();
    expect(() => assertCampaignTransition("closed", "archived")).not.toThrow();
    expect(() => assertCampaignTransition("draft", "closed")).toThrow("Transição de campanha inválida");
    expect(() => assertCampaignTransition("archived", "active")).toThrow("Transição de campanha inválida");
  });

  it("keeps freezing independent of lifecycle but blocks archived campaigns", () => {
    expect(canFreezeCampaign("draft")).toBe(true);
    expect(canFreezeCampaign("active")).toBe(true);
    expect(canFreezeCampaign("closed")).toBe(true);
    expect(canFreezeCampaign("archived")).toBe(false);
  });

  it("normalizes codes while allowing the same code in separate partners", () => {
    expect(normalizeCampaignCode("  Fibra Setembro ")).toBe("fibra-setembro");
    expect(() => normalizeCampaignCode("***")).toThrow();
    expect(canViewCampaignByPdvScope(adminA, 10, [50], [])).toBe(true);
    expect(canViewCampaignByPdvScope({ ...adminA, partnerId: 20 }, 20, [50], [])).toBe(true);
  });

  it("restricts Manager and Seller to an intersecting PDV assignment", () => {
    expect(canViewCampaignByPdvScope(managerA, 10, [50, 51], [51])).toBe(true);
    expect(canViewCampaignByPdvScope(managerA, 10, [50], [51])).toBe(false);
    expect(canViewCampaignByPdvScope(sellerA, 10, [50], [50])).toBe(true);
  });

  it("blocks campaign IDOR across tenants before returning a campaign", () => {
    expect(() => canViewCampaignByPdvScope(sellerA, 20, [50], [50])).toThrow(PartnerAccessError);
  });
});
