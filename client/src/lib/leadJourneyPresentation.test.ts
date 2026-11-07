import { describe, expect, it } from "vitest";
import {
  presentNextLeadAction,
  resolveLeadJourneyPermissions,
} from "./leadJourneyPresentation";

describe("unified lead journey presentation", () => {
  it("presents backend next-action states without deriving commercial rules in React", () => {
    expect(
      presentNextLeadAction({
        kind: "make_first_contact_attempt",
        hasResidualFollowUp: false,
      })
    ).toMatchObject({
      title: "Faça a primeira tentativa de contato",
      cta: "contact",
    });
    expect(
      presentNextLeadAction({
        kind: "complete_governance",
        hasResidualFollowUp: false,
      })
    ).toMatchObject({ cta: "evidence", tone: "warning" });
  });

  it("does not turn a residual follow-up on a terminal lead into a commercial CTA", () => {
    expect(
      presentNextLeadAction({
        kind: "lead_terminal",
        hasResidualFollowUp: true,
      })
    ).toMatchObject({
      cta: "none",
      description:
        "Há um follow-up anterior pendente para revisão, mas nenhuma nova ação comercial é sugerida.",
    });
  });

  it("lets an operational seller claim an available Lead without granting commercial work early", () => {
    expect(
      resolveLeadJourneyPermissions({
        role: "seller",
        membershipId: 41,
        assignedMembershipId: null,
        commercialActionsBlocked: false,
      })
    ).toMatchObject({
      canAssumeLead: true,
      canOperateOwnLead: false,
      canStartCommercialWork: false,
    });
  });

  it("moves commercial permission to the seller only after confirmed ownership", () => {
    expect(
      resolveLeadJourneyPermissions({
        role: "seller",
        membershipId: 41,
        assignedMembershipId: 41,
        commercialActionsBlocked: false,
      })
    ).toMatchObject({
      canAssumeLead: false,
      canOperateOwnLead: true,
      canStartCommercialWork: true,
    });

    expect(
      resolveLeadJourneyPermissions({
        role: "seller",
        membershipId: 41,
        assignedMembershipId: 42,
        commercialActionsBlocked: false,
      })
    ).toMatchObject({
      canAssumeLead: false,
      canOperateOwnLead: false,
      canStartCommercialWork: false,
    });
  });

  it("never offers a claim for terminal, frozen or closed campaign states", () => {
    for (const commercialActionsBlocked of [true]) {
      expect(
        resolveLeadJourneyPermissions({
          role: "seller",
          membershipId: 41,
          assignedMembershipId: null,
          commercialActionsBlocked,
        })
      ).toMatchObject({
        canAssumeLead: false,
        canStartCommercialWork: false,
      });
    }
  });

  it("keeps Gestão read-only even when the Lead is assigned in its scope", () => {
    expect(
      resolveLeadJourneyPermissions({
        role: "management",
        membershipId: 81,
        assignedMembershipId: 81,
        commercialActionsBlocked: false,
      })
    ).toMatchObject({
      canAssumeLead: false,
      canOperateOwnLead: false,
      canStartCommercialWork: false,
    });
  });
});
