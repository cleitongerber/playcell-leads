import { describe, expect, it } from "vitest";
import {
  buildV2Path,
  normalizedV2Pathname,
  resolveV2BackPath,
  safeInternalV2Path,
  safeV2ReturnPath,
} from "./operationalNavigation";

const seller = "seller" as const;
const administrator = "partner_admin" as const;

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
      safeV2ReturnPath(
        "/v2/leads?view=all&campaignId=9#results",
        "/v2/leads",
        seller
      )
    ).toBe("/v2/leads?view=all&campaignId=9#results");
  });

  it("rejects external and malformed return locations", () => {
    expect(safeV2ReturnPath("https://example.com", "/v2/leads", seller)).toBe(
      "/v2/leads"
    );
    expect(safeV2ReturnPath("//example.com", "/v2/leads", seller)).toBe("/v2/leads");
    expect(safeV2ReturnPath("/v2\\leads", "/v2/leads", seller)).toBe("/v2/leads");
  });

  it("chooses the contextual list URL before observed history and preserves its filters", () => {
    expect(
      resolveV2BackPath({
        currentPath: "/v2/leads/19",
        from: "/v2/leads?view=assigned&campaignId=9&pdvId=3#results",
        previousPath: "/v2/dashboard",
        fallbackPath: "/v2/leads",
        role: administrator,
      })
    ).toBe("/v2/leads?view=assigned&campaignId=9&pdvId=3#results");
  });

  it("uses only an observed internal location or its contextual fallback", () => {
    expect(
      resolveV2BackPath({
        currentPath: "/v2/reports",
        previousPath: "/v2/productivity?period=month",
        fallbackPath: "/v2/dashboard",
        role: seller,
      })
    ).toBe("/v2/productivity?period=month");
    expect(
      resolveV2BackPath({
        currentPath: "/v2/leads/19",
        previousPath: "https://example.com/leave",
        fallbackPath: "/v2/leads",
        role: seller,
      })
    ).toBe("/v2/leads");
  });

  it("does not create a back destination for the current page or malformed input", () => {
    expect(safeInternalV2Path("/v2/leads?view=all", seller)).toBe(
      "/v2/leads?view=all"
    );
    expect(safeInternalV2Path("//example.com/v2/leads", seller)).toBeNull();
    expect(
      resolveV2BackPath({
        currentPath: "/v2/dashboard",
        from: "/v2/dashboard",
        role: seller,
      })
    ).toBeNull();
  });

  it("accepts only existing routes that the active role may access", () => {
    expect(safeInternalV2Path("/v2/leads/19?view=assigned", seller)).toBe(
      "/v2/leads/19?view=assigned"
    );
    expect(safeInternalV2Path("/v2/governance", seller)).toBeNull();
    expect(safeInternalV2Path("/v2/governance", administrator)).toBe(
      "/v2/governance"
    );
  });

  it("rejects auth, nonexistent, traversal and malformed V2 routes", () => {
    for (const value of [
      "/v2/login",
      "/v2/logout",
      "/v2/does-not-exist",
      "/login",
      "https://example.com/v2/leads",
      "//example.com/v2/leads",
      "/v2/leads/../admin",
      "/v2/leads/%2e%2e/admin",
      "/v2//leads",
      "/v2/leads/%E0%A4%A",
    ]) {
      expect(safeInternalV2Path(value, administrator)).toBeNull();
    }
  });

  it("falls back when the active role changed or no authorized context exists", () => {
    expect(
      resolveV2BackPath({
        currentPath: "/v2/leads/19",
        from: "/v2/governance",
        fallbackPath: "/v2/leads",
        role: seller,
      })
    ).toBe("/v2/leads");
    expect(
      resolveV2BackPath({
        currentPath: "/v2/leads/19",
        from: "/v2/leads",
        role: null,
      })
    ).toBeNull();
  });

  it("treats query and hash variants of the same pathname as self references", () => {
    expect(normalizedV2Pathname("/v2/leads/19?tab=history#item")).toBe(
      "/v2/leads/19"
    );
    expect(
      resolveV2BackPath({
        currentPath: "/v2/leads/19?tab=history",
        from: "/v2/leads/19?tab=details",
        previousPath: "/v2/leads/19#activity",
        fallbackPath: "/v2/leads?view=assigned&campaignId=9",
        role: seller,
      })
    ).toBe("/v2/leads?view=assigned&campaignId=9");
    expect(
      resolveV2BackPath({
        currentPath: "/v2/leads/19",
        fallbackPath: "/v2/leads/19#activity",
        role: seller,
      })
    ).toBeNull();
  });

  it("keeps full state for valid destinations with a different pathname", () => {
    expect(
      resolveV2BackPath({
        currentPath: "/v2/leads/19?tab=history",
        from: "/v2/leads/20?tab=details#activity",
        role: seller,
      })
    ).toBe("/v2/leads/20?tab=details#activity");
  });
});
