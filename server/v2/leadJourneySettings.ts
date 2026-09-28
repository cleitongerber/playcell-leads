import { eq } from "drizzle-orm";
import { partnerSettings, type LeadJourneyMode } from "../../drizzle-v2/schema";
import type { V2Database } from "./database";
import { normalizeLeadJourneyMode } from "./leadJourneyDomain";

/**
 * This read-only helper intentionally has no public mutation path in 016.1.
 * A partner cannot be accidentally switched to an unfinished journey.
 */
export async function getPartnerLeadJourneyMode(
  db: V2Database,
  partnerId: number
): Promise<LeadJourneyMode> {
  const settings = (
    await db
      .select({ leadJourneyMode: partnerSettings.leadJourneyMode })
      .from(partnerSettings)
      .where(eq(partnerSettings.partnerId, partnerId))
      .limit(1)
  )[0];
  return normalizeLeadJourneyMode(settings?.leadJourneyMode);
}
