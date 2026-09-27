import { describe, expect, it } from "vitest";
import { buildV2Path, safeV2ReturnPath } from "./operationalNavigation";

describe("operational navigation", () => {
  it("serializes only meaningful internal query values", () => {
    expect(
      buildV2Path("/v2/leads", {
        view: "available",
        campaignId: 42,
        page: 2,
        search: "Ana & João",
        unused: undefined,
        blank: "",
      })
    ).toBe(
      "/v2/leads?view=available&campaignId=42&page=2&search=Ana+%26+Jo%C3%A3o"
    );
  });

  it("allows a precise V2 return location", () => {
    expect(
      safeV2ReturnPath("/v2/leads?view=all&campaignId=9#results", "/v2/leads")
    ).toBe("/v2/leads?view=all&campaignId=9#results");
  });

  it("rejects external and malformed return locations", () => {
    expect(safeV2ReturnPath("https://example.com", "/v2/leads")).toBe(
      "/v2/leads"
    );
    expect(safeV2ReturnPath("//example.com", "/v2/leads")).toBe("/v2/leads");
    expect(safeV2ReturnPath("/v2\\leads", "/v2/leads")).toBe("/v2/leads");
  });
});
