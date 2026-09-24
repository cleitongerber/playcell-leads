import { assertPartnerOwnership, type PartnerContext } from "./access";

export function assertEvidenceLeadScope(
  context: PartnerContext,
  lead: {
    partnerId: number;
    pdvId: number;
    assignedMembershipId: number | null;
  },
  scopedPdvIds: readonly number[] | null
) {
  assertPartnerOwnership(lead.partnerId, context);
  if (scopedPdvIds && !scopedPdvIds.includes(lead.pdvId)) {
    throw new Error("Lead não encontrado");
  }
  if (
    context.role === "seller" &&
    lead.assignedMembershipId !== context.membershipId
  ) {
    throw new Error("Lead não encontrado");
  }
  return true;
}

export function assertEvidenceTimelineTarget(
  expected: { partnerId: number; leadId: number },
  event: { partnerId: number; leadId: number } | undefined
) {
  if (
    !event ||
    event.partnerId !== expected.partnerId ||
    event.leadId !== expected.leadId
  ) {
    throw new Error("Evento da timeline não pertence a este lead");
  }
  return true;
}
