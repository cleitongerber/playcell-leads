import { and, asc, eq, sql } from "drizzle-orm";
import {
  leadInteractionResults,
  leadSources,
  leadStatuses,
  type LeadInteractionConversionMode,
  type LeadInteractionFollowUpPolicy,
  type LeadInteractionKind,
  type LeadInteractionStatusPolicy,
  type LeadStatusCategory,
} from "../../drizzle-v2/schema";
import type { V2Database } from "./database";

const defaultStatuses: Array<{
  code: string;
  label: string;
  category: LeadStatusCategory;
  sortOrder: number;
  isTerminal: boolean;
}> = [
  {
    code: "new",
    label: "Novo",
    category: "open",
    sortOrder: 10,
    isTerminal: false,
  },
  {
    code: "assigned",
    label: "Assumido",
    category: "in_progress",
    sortOrder: 20,
    isTerminal: false,
  },
  {
    code: "contacted",
    label: "Contatado",
    category: "in_progress",
    sortOrder: 30,
    isTerminal: false,
  },
  {
    code: "qualified",
    label: "Interessado",
    category: "in_progress",
    sortOrder: 40,
    isTerminal: false,
  },
  {
    code: "converted",
    label: "Convertido",
    category: "completed",
    sortOrder: 90,
    isTerminal: true,
  },
  {
    code: "lost",
    label: "Sem interesse",
    category: "discarded",
    sortOrder: 100,
    isTerminal: true,
  },
];

const defaultSources = [
  { code: "manual", label: "Cadastro manual" },
  { code: "import", label: "Importação" },
];

type DefaultInteractionResult = {
  interactionKind: LeadInteractionKind;
  code: string;
  label: string;
  category: string;
  suggestedStatusCode: string | null;
  statusPolicy: LeadInteractionStatusPolicy;
  allowSellerOverride: boolean;
  followUpPolicy: LeadInteractionFollowUpPolicy;
  conversionMode: LeadInteractionConversionMode;
  sortOrder: number;
};

/**
 * These stable codes, rather than labels, are the safe default catalog for a
 * partner. Existing catalog rows are never overwritten by re-initialization.
 */
export const defaultInteractionResults: DefaultInteractionResult[] = [
  {
    interactionKind: "attempt",
    code: "message_sent",
    label: "Mensagem enviada",
    category: "awaiting_response",
    suggestedStatusCode: null,
    statusPolicy: "none",
    allowSellerOverride: true,
    followUpPolicy: "optional",
    conversionMode: "none",
    sortOrder: 10,
  },
  {
    interactionKind: "attempt",
    code: "no_answer",
    label: "Não atendeu",
    category: "unreachable",
    suggestedStatusCode: null,
    statusPolicy: "none",
    allowSellerOverride: true,
    followUpPolicy: "optional",
    conversionMode: "none",
    sortOrder: 20,
  },
  {
    interactionKind: "attempt",
    code: "busy",
    label: "Ocupado",
    category: "unreachable",
    suggestedStatusCode: null,
    statusPolicy: "none",
    allowSellerOverride: true,
    followUpPolicy: "optional",
    conversionMode: "none",
    sortOrder: 30,
  },
  {
    interactionKind: "attempt",
    code: "voicemail",
    label: "Caixa postal",
    category: "unreachable",
    suggestedStatusCode: null,
    statusPolicy: "none",
    allowSellerOverride: true,
    followUpPolicy: "optional",
    conversionMode: "none",
    sortOrder: 40,
  },
  {
    interactionKind: "attempt",
    code: "invalid_contact",
    label: "Número inválido",
    category: "invalid_contact",
    suggestedStatusCode: null,
    statusPolicy: "none",
    allowSellerOverride: true,
    followUpPolicy: "not_applicable",
    conversionMode: "none",
    sortOrder: 50,
  },
  {
    interactionKind: "attempt",
    code: "other_attempt",
    label: "Outro",
    category: "other",
    suggestedStatusCode: null,
    statusPolicy: "none",
    allowSellerOverride: true,
    followUpPolicy: "optional",
    conversionMode: "none",
    sortOrder: 60,
  },
  {
    interactionKind: "effective_contact",
    code: "interested",
    label: "Interessado",
    category: "interested",
    suggestedStatusCode: "qualified",
    statusPolicy: "suggest",
    allowSellerOverride: true,
    followUpPolicy: "optional",
    conversionMode: "none",
    sortOrder: 10,
  },
  {
    interactionKind: "effective_contact",
    code: "return_later",
    label: "Retornar depois",
    category: "follow_up",
    suggestedStatusCode: "contacted",
    statusPolicy: "suggest",
    allowSellerOverride: true,
    followUpPolicy: "required",
    conversionMode: "none",
    sortOrder: 20,
  },
  {
    interactionKind: "effective_contact",
    code: "not_interested",
    label: "Não interessado",
    category: "negative",
    suggestedStatusCode: "lost",
    statusPolicy: "require",
    allowSellerOverride: false,
    followUpPolicy: "not_applicable",
    conversionMode: "none",
    sortOrder: 30,
  },
  {
    interactionKind: "effective_contact",
    code: "sale_completed",
    label: "Venda realizada",
    category: "conversion",
    suggestedStatusCode: "converted",
    statusPolicy: "require",
    allowSellerOverride: false,
    followUpPolicy: "not_applicable",
    conversionMode: "eligible",
    sortOrder: 40,
  },
  {
    interactionKind: "effective_contact",
    code: "other_contact",
    label: "Outro",
    category: "other",
    suggestedStatusCode: null,
    statusPolicy: "none",
    allowSellerOverride: true,
    followUpPolicy: "optional",
    conversionMode: "none",
    sortOrder: 50,
  },
];

/** Idempotent configuration seed, called when a partner is created or explicitly initialized. */
export async function seedPartnerLeadConfiguration(
  db: V2Database,
  partnerId: number
) {
  for (const status of defaultStatuses) {
    await db
      .insert(leadStatuses)
      .values({ partnerId, ...status })
      .onDuplicateKeyUpdate({
        set: {
          label: status.label,
          category: status.category,
          sortOrder: status.sortOrder,
          isTerminal: status.isTerminal,
        },
      });
  }
  for (const source of defaultSources) {
    await db
      .insert(leadSources)
      .values({ partnerId, ...source })
      .onDuplicateKeyUpdate({ set: { label: source.label } });
  }

  const statusRows = await db
    .select({ id: leadStatuses.id, code: leadStatuses.code })
    .from(leadStatuses)
    .where(eq(leadStatuses.partnerId, partnerId));
  const statusIdByCode = new Map(
    statusRows.map(status => [status.code, status.id])
  );
  await db
    .insert(leadInteractionResults)
    .values(
      defaultInteractionResults.map(result => ({
        partnerId,
        interactionKind: result.interactionKind,
        code: result.code,
        label: result.label,
        category: result.category,
        suggestedStatusId: result.suggestedStatusCode
          ? (statusIdByCode.get(result.suggestedStatusCode) ?? null)
          : null,
        statusPolicy: result.statusPolicy,
        allowSellerOverride: result.allowSellerOverride,
        followUpPolicy: result.followUpPolicy,
        conversionMode: result.conversionMode,
        sortOrder: result.sortOrder,
      }))
    )
    // A subsequent initialization must only fill missing defaults; it cannot
    // overwrite a Partner Admin's configured label or policy.
    .onDuplicateKeyUpdate({ set: { id: sql`${leadInteractionResults.id}` } });
}

export async function listPartnerLeadStatuses(
  db: V2Database,
  partnerId: number,
  includeInactive = false
) {
  const rows = await db
    .select()
    .from(leadStatuses)
    .where(eq(leadStatuses.partnerId, partnerId))
    .orderBy(asc(leadStatuses.sortOrder), asc(leadStatuses.label));
  return includeInactive ? rows : rows.filter(status => status.isActive);
}

export async function listPartnerLeadSources(
  db: V2Database,
  partnerId: number,
  includeInactive = false
) {
  const rows = await db
    .select()
    .from(leadSources)
    .where(eq(leadSources.partnerId, partnerId))
    .orderBy(asc(leadSources.label));
  return includeInactive ? rows : rows.filter(source => source.isActive);
}

export async function listPartnerInteractionResults(
  db: V2Database,
  partnerId: number,
  interactionKind?: LeadInteractionKind,
  includeInactive = false
) {
  const rows = await db
    .select()
    .from(leadInteractionResults)
    .where(
      interactionKind
        ? and(
            eq(leadInteractionResults.partnerId, partnerId),
            eq(leadInteractionResults.interactionKind, interactionKind)
          )
        : eq(leadInteractionResults.partnerId, partnerId)
    )
    .orderBy(
      asc(leadInteractionResults.interactionKind),
      asc(leadInteractionResults.sortOrder),
      asc(leadInteractionResults.label)
    );
  return includeInactive ? rows : rows.filter(result => result.isActive);
}
