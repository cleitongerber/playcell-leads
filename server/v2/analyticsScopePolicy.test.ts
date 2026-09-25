import { describe, expect, it } from "vitest";
import {
  batchIsWhollyInsideAnalyticsScope,
  pdvIsInsideAnalyticsScope,
  sellerIsInsideAnalyticsScope,
} from "./analyticsScopePolicy";

describe("V2 analytics scope policy", () => {
  it("does not turn a valid PDV id into access outside a Manager scope", () => {
    expect(pdvIsInsideAnalyticsScope([10, 11], 10)).toBe(true);
    expect(pdvIsInsideAnalyticsScope([10, 11], 99)).toBe(false);
    expect(pdvIsInsideAnalyticsScope(null, 99)).toBe(true);
  });

  it("keeps a Seller confined to their own membership metrics", () => {
    expect(sellerIsInsideAnalyticsScope(20, 20)).toBe(true);
    expect(sellerIsInsideAnalyticsScope(20, 21)).toBe(false);
    expect(sellerIsInsideAnalyticsScope(null, 21)).toBe(true);
  });

  it("does not disclose mixed-PDV distribution batch totals to a restricted manager", () => {
    expect(batchIsWhollyInsideAnalyticsScope([10, 11], [10, 11])).toBe(true);
    expect(batchIsWhollyInsideAnalyticsScope([10, 99], [10, 11])).toBe(false);
    expect(batchIsWhollyInsideAnalyticsScope([], [10, 11])).toBe(false);
  });
});
