import { describe, expect, it } from "vitest";
import {
  LeadJourneyOperationError,
  assertAdministrativeStatusRole,
  assertAdministrativeStatusTransition,
  assertFollowUpApplicability,
  assertLeadAcceptsCommercialOperation,
  assertConversionStatus,
  isFollowUpRequired,
  resolveEffectiveContactFollowUp,
  requiresAdministrativeStatusReason,
  resolveEffectiveContactFinalStatus,
} from "./leadJourneyOperationalPolicy";

const suggested = {
  statusPolicy: "suggest" as const,
  suggestedStatusId: 10,
  allowSellerOverride: false,
  followUpPolicy: "optional" as const,
  conversionMode: "none" as const,
};

describe("separated journey operational policy", () => {
  it("applies status policy without using display labels", () => {
    expect(
      resolveEffectiveContactFinalStatus({
        role: "seller",
        policy: { ...suggested, allowSellerOverride: true },
        requestedStatusId: 12,
      })
    ).toBe(12);
    expect(
      resolveEffectiveContactFinalStatus({
        role: "seller",
        policy: { ...suggested, statusPolicy: "require" },
      })
    ).toBe(10);
    expect(() =>
      resolveEffectiveContactFinalStatus({
        role: "seller",
        policy: suggested,
        requestedStatusId: 12,
      })
    ).toThrow(LeadJourneyOperationError);
  });

  it("lets result configuration strengthen, never weaken, follow-up governance", () => {
    expect(
      isFollowUpRequired({
        governanceRequiresFollowUp: true,
        resultPolicy: "not_applicable",
      })
    ).toBe(true);
    expect(
      isFollowUpRequired({
        governanceRequiresFollowUp: false,
        resultPolicy: "required",
      })
    ).toBe(true);
  });

  it("does not create a residual follow-up after a terminal treatment", () => {
    expect(
      resolveEffectiveContactFollowUp({
        governanceRequiresFollowUp: true,
        resultPolicy: "required",
        finalStatusIsTerminal: true,
      })
    ).toEqual({ required: false, allowed: false });
    expect(
      resolveEffectiveContactFollowUp({
        governanceRequiresFollowUp: true,
        resultPolicy: "optional",
        finalStatusIsTerminal: false,
      })
    ).toEqual({ required: true, allowed: true });
    expect(() =>
      assertFollowUpApplicability({
        governanceRequiresFollowUp: true,
        resultPolicy: "required",
        finalStatusIsTerminal: true,
        hasFollowUp: true,
      })
    ).toThrow("situação terminal");
  });

  it("keeps administrative status and conversion semantics explicit", () => {
    expect(() => assertAdministrativeStatusRole("seller")).toThrow(
      "ajuste administrativo"
    );
    expect(
      requiresAdministrativeStatusReason({
        previousIsTerminal: false,
        nextIsTerminal: true,
      })
    ).toBe(true);
    expect(() =>
      assertConversionStatus({
        conversionMode: "eligible",
        statusIsTerminal: true,
        statusCategory: "discarded",
      })
    ).toThrow("conversão");
  });

  it("uses a required configured status even when the caller omits it", () => {
    expect(
      resolveEffectiveContactFinalStatus({
        role: "manager",
        policy: { ...suggested, statusPolicy: "require" },
        requestedStatusId: null,
      })
    ).toBe(10);
    expect(() =>
      resolveEffectiveContactFinalStatus({
        role: "partner_admin",
        policy: { ...suggested, statusPolicy: "require" },
        requestedStatusId: 44,
      })
    ).toThrow("exige");
  });

  it("does not let a result create an inapplicable follow-up unless governance is stricter", () => {
    expect(() =>
      assertFollowUpApplicability({
        governanceRequiresFollowUp: false,
        resultPolicy: "not_applicable",
        hasFollowUp: true,
      })
    ).toThrow("não permite");
    expect(
      assertFollowUpApplicability({
        governanceRequiresFollowUp: true,
        resultPolicy: "not_applicable",
        hasFollowUp: true,
      })
    ).toBe(true);
  });

  it("requires explicit reopening before a new commercial action on a terminal lead", () => {
    expect(() => assertLeadAcceptsCommercialOperation(true)).toThrow("Reabra");
    expect(() =>
      assertAdministrativeStatusTransition({
        previousIsTerminal: true,
        nextIsTerminal: false,
      })
    ).toThrow("reabrir");
    expect(
      assertAdministrativeStatusTransition({
        previousIsTerminal: false,
        nextIsTerminal: true,
      })
    ).toBe(true);
  });
});
