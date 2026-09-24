import { describe, expect, it } from "vitest";
import {
  campaignAllowsLeadOperations,
  conditionalClaim,
  sellerCanModifyLead,
} from "./leadPolicy";

describe("Lead V2 operational policy", () => {
  it("blocks frozen, closed and archived campaigns while allowing an active unfrozen campaign", () => {
    expect(campaignAllowsLeadOperations("active", false)).toBe(true);
    expect(campaignAllowsLeadOperations("active", true)).toBe(false);
    expect(campaignAllowsLeadOperations("closed", false)).toBe(false);
    expect(campaignAllowsLeadOperations("archived", false)).toBe(false);
  });

  it("does not allow a Seller to modify another Seller's wallet", () => {
    expect(sellerCanModifyLead(101, 101)).toBe(true);
    expect(sellerCanModifyLead(101, 102)).toBe(false);
    expect(sellerCanModifyLead(null, 101)).toBe(false);
  });

  it("models the single-winner compare-and-set claim used by SQL", async () => {
    const results = await Promise.all([
      Promise.resolve().then(() => conditionalClaim(null, 101)),
      Promise.resolve().then(() => conditionalClaim(101, 102)),
    ]);
    expect(results.filter(result => result.won)).toHaveLength(1);
    expect(results[0].assignedMembershipId).toBe(101);
    expect(results[1].assignedMembershipId).toBe(101);
  });
});
