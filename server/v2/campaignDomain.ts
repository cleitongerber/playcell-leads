import type { CampaignStatus } from "../../drizzle-v2/schema";
import { assertPartnerOwnership, type PartnerContext } from "./access";

const transitions: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["active"],
  active: ["closed"],
  closed: ["archived"],
  archived: [],
};

export function assertCampaignTransition(from: CampaignStatus, to: CampaignStatus) {
  if (!transitions[from].includes(to)) {
    throw new Error(`Transição de campanha inválida: ${from} → ${to}`);
  }
}

export function canEditCampaign(status: CampaignStatus) {
  return status === "draft";
}

export function canFreezeCampaign(status: CampaignStatus) {
  return status !== "archived";
}

export function normalizeCampaignCode(code: string) {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!normalized) throw new Error("Código da campanha inválido");
  return normalized;
}

export const campaignMetricsUnavailable = {
  status: "unavailable" as const,
  reason: "Leads V2 e importações V2 ainda não foram implementados.",
  leadsReceived: null,
  leadsAvailable: null,
  leadsInProgress: null,
  leadsCompleted: null,
};

export function canViewCampaignByPdvScope(
  context: PartnerContext,
  campaignPartnerId: number,
  campaignPdvIds: readonly number[],
  accessiblePdvIds: readonly number[]
) {
  assertPartnerOwnership(campaignPartnerId, context);
  if (context.role === "super_admin" || context.role === "partner_admin") return true;
  const accessible = new Set(accessiblePdvIds);
  return campaignPdvIds.some(pdvId => accessible.has(pdvId));
}
