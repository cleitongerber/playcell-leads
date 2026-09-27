import { describe, expect, it } from "vitest";
import {
  analyticsFiltersFromSearch,
  analyticsFiltersToSearch,
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
});
