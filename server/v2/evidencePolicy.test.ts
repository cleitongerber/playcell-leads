import { describe, expect, it } from "vitest";
import { PartnerAccessError, type PartnerContext } from "./access";
import {
  assertEvidenceLeadScope,
  assertEvidenceTimelineTarget,
} from "./evidencePolicy";

const adminA: PartnerContext = {
  userId: 1,
  partnerId: 10,
  membershipId: 101,
  role: "partner_admin",
};
const managerA: PartnerContext = {
  userId: 2,
  partnerId: 10,
  membershipId: 102,
  role: "manager",
};
const sellerA: PartnerContext = {
  userId: 3,
  partnerId: 10,
  membershipId: 103,
  role: "seller",
};

describe("V2 evidence tenant and wallet policy", () => {
  it("rejects an evidence target from another tenant before it can be opened", () => {
    expect(() =>
      assertEvidenceLeadScope(
        sellerA,
        { partnerId: 20, pdvId: 1, assignedMembershipId: 103 },
        [1]
      )
    ).toThrow(PartnerAccessError);
  });

  it("limits manager to assigned PDVs and seller to their own wallet", () => {
    expect(() =>
      assertEvidenceLeadScope(
        managerA,
        { partnerId: 10, pdvId: 9, assignedMembershipId: 103 },
        [8]
      )
    ).toThrow("Lead não encontrado");
    expect(() =>
      assertEvidenceLeadScope(
        sellerA,
        { partnerId: 10, pdvId: 8, assignedMembershipId: 104 },
        [8]
      )
    ).toThrow("Lead não encontrado");
    expect(
      assertEvidenceLeadScope(
        sellerA,
        { partnerId: 10, pdvId: 8, assignedMembershipId: 103 },
        [8]
      )
    ).toBe(true);
  });

  it("allows Partner Admin only within the selected tenant", () => {
    expect(
      assertEvidenceLeadScope(
        adminA,
        { partnerId: 10, pdvId: 999, assignedMembershipId: 104 },
        null
      )
    ).toBe(true);
  });

  it("rejects a valid timeline event when it belongs to another lead or tenant", () => {
    expect(() =>
      assertEvidenceTimelineTarget(
        { partnerId: 10, leadId: 100 },
        { partnerId: 10, leadId: 101 }
      )
    ).toThrow("não pertence");
    expect(() =>
      assertEvidenceTimelineTarget(
        { partnerId: 10, leadId: 100 },
        { partnerId: 20, leadId: 100 }
      )
    ).toThrow("não pertence");
  });
});
