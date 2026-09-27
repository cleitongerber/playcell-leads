import { eq } from "drizzle-orm";
import { partnerSettings } from "../../drizzle-v2/schema";
import {
  DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE,
  referencedWhatsAppTemplateVariables,
} from "../../shared/whatsappContact";
import { type PartnerContext, requirePartnerRole } from "./access";
import { getV2Db, type V2Database } from "./database";
import { writeV2Audit } from "./partnerService";

const MAX_TEMPLATE_LENGTH = 4000;

/**
 * Keep template bodies out of audit logs. Apart from avoiding needless
 * duplication, a template can contain business wording or placeholders that
 * become personal data once rendered for a lead.
 */
export function whatsappTemplateAuditMetadata(template: string) {
  return {
    setting: "whatsappInitialMessageTemplate",
    templateLength: template.length,
    variables: referencedWhatsAppTemplateVariables(template),
  };
}

function normalizeTemplate(template: string) {
  const normalized = template.trim();
  if (!normalized)
    throw new Error("A mensagem inicial do WhatsApp não pode ser vazia");
  if (normalized.length > MAX_TEMPLATE_LENGTH) {
    throw new Error("A mensagem inicial do WhatsApp é muito longa");
  }
  return normalized;
}

async function loadTemplate(db: V2Database, partnerId: number) {
  const row = (
    await db
      .select({ template: partnerSettings.whatsappInitialMessageTemplate })
      .from(partnerSettings)
      .where(eq(partnerSettings.partnerId, partnerId))
      .limit(1)
  )[0];
  return row?.template || DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE;
}

/** Available to every active member, but always resolved from PartnerContext. */
export async function getWhatsAppInitialMessageTemplate(
  context: PartnerContext
) {
  const db = await getV2Db();
  return { template: await loadTemplate(db, context.partnerId) };
}

/** Only a Partner Admin (or Super Admin in an explicit PartnerContext) can edit. */
export async function updateWhatsAppInitialMessageTemplate(
  context: PartnerContext,
  template: string
) {
  requirePartnerRole(context, ["partner_admin", "super_admin"]);
  const normalized = normalizeTemplate(template);
  const db = await getV2Db();
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx
      .insert(partnerSettings)
      .values({
        partnerId: context.partnerId,
        whatsappInitialMessageTemplate: normalized,
      })
      .onDuplicateKeyUpdate({
        set: {
          whatsappInitialMessageTemplate: normalized,
          updatedAt: new Date(),
        },
      });
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "partner_whatsapp_template_updated",
      entityType: "partner_settings",
      entityId: context.partnerId,
      metadata: whatsappTemplateAuditMetadata(normalized),
    });
  });
  return { template: normalized };
}
