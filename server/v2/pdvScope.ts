import { and, eq } from "drizzle-orm";
import { userPdvAssignments } from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import type { V2Database } from "./database";

/**
 * `null` represents the whole partner and deliberately avoids materialising a
 * potentially large list of PDV IDs. A non-null array is an explicit allowlist.
 */
export async function resolvePdvScope(
  db: V2Database,
  context: PartnerContext
): Promise<number[] | null> {
  if (
    context.role === "super_admin" ||
    context.role === "partner_admin" ||
    context.pdvScopeMode === "all"
  ) {
    return null;
  }
  if (!context.membershipId) return [];
  const rows = await db
    .select({ pdvId: userPdvAssignments.pdvId })
    .from(userPdvAssignments)
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId),
        eq(userPdvAssignments.isActive, true)
      )
    );
  return rows.map(row => row.pdvId);
}

export function hasPdvScope(
  scope: readonly number[] | null,
  pdvId: number
) {
  return scope === null || scope.includes(pdvId);
}
