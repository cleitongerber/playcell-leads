import { describe, expect, it } from "vitest";
import {
  canAdministrateDistribution,
  defaultDistributionReason,
  ownerTransitionEligibility,
  planBalancedDistribution,
  queueReturnEligibility,
} from "./distributionDomain";

describe("V2 lead distribution domain", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");

  it("allows only administrative roles to distribute the base", () => {
    expect(canAdministrateDistribution("partner_admin")).toBe(true);
    expect(canAdministrateDistribution("manager")).toBe(true);
    expect(canAdministrateDistribution("super_admin")).toBe(true);
    expect(canAdministrateDistribution("seller")).toBe(false);
  });

  it("keeps responsibility transitions separate from commercial status", () => {
    expect(ownerTransitionEligibility("assign", null, 10)).toBeNull();
    expect(ownerTransitionEligibility("assign", 10, 11)).toBe("already_assigned");
    expect(ownerTransitionEligibility("reassign", null, 11)).toBe("unassigned");
    expect(ownerTransitionEligibility("reassign", 10, 10)).toBe("same_owner");
    expect(ownerTransitionEligibility("return_to_queue", 10)).toBeNull();
    expect(defaultDistributionReason("balanced")).toBe(
      "Distribuição equilibrada"
    );
  });

  it("balances new leads against the existing active portfolio deterministically", () => {
    const plan = planBalancedDistribution(
      [
        { id: 1, pdvId: 8, assignedMembershipId: null, receivedAt: now },
        { id: 2, pdvId: 8, assignedMembershipId: null, receivedAt: now },
        { id: 3, pdvId: 8, assignedMembershipId: null, receivedAt: now },
        { id: 4, pdvId: 8, assignedMembershipId: null, receivedAt: now },
      ],
      [
        { membershipId: 100, pdvIds: [8], activeLeadCount: 10 },
        { membershipId: 101, pdvIds: [8], activeLeadCount: 2 },
      ]
    );

    expect(plan.assignments.map(item => item.membershipId)).toEqual([
      101, 101, 101, 101,
    ]);
    expect(plan.resultingLoads.get(100)).toBe(10);
    expect(plan.resultingLoads.get(101)).toBe(6);
  });

  it("spreads an equal batch across equally loaded eligible sellers", () => {
    const plan = planBalancedDistribution(
      Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        pdvId: 8,
        assignedMembershipId: null,
        receivedAt: now,
      })),
      [10, 11, 12, 13].map(membershipId => ({
        membershipId,
        pdvIds: [8],
        activeLeadCount: 0,
      }))
    );
    const assignmentsBySeller = plan.assignments.reduce(
      (counts, assignment) => {
        counts.set(
          assignment.membershipId,
          (counts.get(assignment.membershipId) ?? 0) + 1
        );
        return counts;
      },
      new Map<number, number>()
    );

    expect(plan.assignments).toHaveLength(100);
    expect(assignmentsBySeller).toEqual(
      new Map([
        [10, 25],
        [11, 25],
        [12, 25],
        [13, 25],
      ])
    );
  });

  it("uses only sellers eligible for each PDV and gives a stable tie-break", () => {
    const plan = planBalancedDistribution(
      [
        { id: 10, pdvId: 1, assignedMembershipId: null, receivedAt: now },
        { id: 11, pdvId: 2, assignedMembershipId: null, receivedAt: now },
        { id: 12, pdvId: 3, assignedMembershipId: null, receivedAt: now },
      ],
      [
        { membershipId: 20, pdvIds: [1, 2], activeLeadCount: 0 },
        { membershipId: 10, pdvIds: [1], activeLeadCount: 0 },
      ]
    );

    expect(plan.assignments).toEqual([
      { leadId: 10, membershipId: 10 },
      { leadId: 11, membershipId: 20 },
    ]);
    expect(plan.skipped).toEqual([
      { leadId: 12, code: "no_eligible_seller" },
    ]);
  });

  it("does not silently return a lead with open operational work to the queue", () => {
    expect(
      queueReturnEligibility({
        hasPendingFollowUp: true,
        hasPendingGovernance: false,
      })
    ).toBe("pending_follow_up");
    expect(
      queueReturnEligibility({
        hasPendingFollowUp: false,
        hasPendingGovernance: true,
      })
    ).toBe("pending_governance");
    expect(
      queueReturnEligibility({
        hasPendingFollowUp: false,
        hasPendingGovernance: false,
      })
    ).toBeNull();
  });

  it("models compare-and-set protection when a seller or another manager wins first", () => {
    const firstManager = ownerTransitionEligibility("assign", null, 50);
    const sellerAfterManager = ownerTransitionEligibility("assign", 50, 51);
    const secondManager = ownerTransitionEligibility("reassign", 51, 52);

    expect(firstManager).toBeNull();
    expect(sellerAfterManager).toBe("already_assigned");
    expect(secondManager).toBeNull();
  });
});
