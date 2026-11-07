import { describe, expect, it } from "vitest";
import {
  analyticsFiltersFromSearch,
  analyticsFiltersToSearch,
  reconcileAnalyticsDependentFilters,
} from "./AnalyticsFilters";

describe("analytics filter URL state", () => {
  it("restores valid filters and ignores invalid tenant dimension ids", () => {
    expect(
      analyticsFiltersFromSearch(
        "?period=last_7_days&campaignId=12&pdvId=4&sellerMembershipId=nope"
      )
    ).toEqual({
      preset: "last_7_days",
      fromDate: undefined,
      toDate: undefined,
      campaignId: 12,
      pdvId: 4,
      sellerMembershipId: undefined,
    });
  });

  it("keeps the default period out of a clean URL", () => {
    expect(
      analyticsFiltersToSearch({
        preset: "this_month",
        campaignId: 8,
        pdvId: 3,
      })
    ).toBe("campaignId=8&pdvId=3");
  });

  it("serializes a custom period deterministically", () => {
    expect(
      analyticsFiltersToSearch({
        preset: "custom",
        fromDate: "2026-09-01",
        toDate: "2026-09-15",
      })
    ).toBe("period=custom&from=2026-09-01&to=2026-09-15");
  });

  it("keeps dependent selections that remain eligible for the selected PDV", () => {
    const current = {
      preset: "this_month" as const,
      pdvId: 4,
      campaignId: 12,
      sellerMembershipId: 21,
    };

    expect(
      reconcileAnalyticsDependentFilters(current, {
        selectedPdvId: 4,
        campaigns: [{ id: 12, name: "Campanha Videira" }],
        sellers: [{ id: 21, name: "Vendedor Videira" }],
      })
    ).toBe(current);
  });

  it("clears only the campaign and seller that become ineligible after a PDV change", () => {
    expect(
      reconcileAnalyticsDependentFilters(
        {
          preset: "last_7_days",
          pdvId: 7,
          campaignId: 12,
          sellerMembershipId: 21,
        },
        {
          selectedPdvId: 7,
          campaigns: [{ id: 99, name: "Campanha Caçador" }],
          sellers: [{ id: 42, name: "Vendedor Caçador" }],
        }
      )
    ).toEqual({
      preset: "last_7_days",
      pdvId: 7,
      campaignId: undefined,
      sellerMembershipId: undefined,
    });
  });

  it("ignores an out-of-order response for a previous PDV", () => {
    const current = { preset: "this_month" as const, pdvId: 7, campaignId: 12 };

    expect(
      reconcileAnalyticsDependentFilters(current, {
        selectedPdvId: 4,
        campaigns: [],
        sellers: [],
      })
    ).toBe(current);
  });
});
