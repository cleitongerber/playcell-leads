/** Pure authorization rules shared by analytics query entry points. */
export function pdvIsInsideAnalyticsScope(
  permittedPdvIds: number[] | null,
  pdvId: number
) {
  return permittedPdvIds === null || permittedPdvIds.includes(pdvId);
}

export function sellerIsInsideAnalyticsScope(
  ownMembershipId: number | null,
  requestedMembershipId: number
) {
  return ownMembershipId === null || ownMembershipId === requestedMembershipId;
}

/**
 * A batch total is safe for a restricted manager only when every affected PDV
 * falls in that manager's scope. Partial batch totals could reveal another
 * PDV's operational volume.
 */
export function batchIsWhollyInsideAnalyticsScope(
  affectedPdvIds: number[],
  permittedPdvIds: number[] | null
) {
  return (
    permittedPdvIds === null ||
    (affectedPdvIds.length > 0 &&
      affectedPdvIds.every(id => permittedPdvIds.includes(id)))
  );
}
