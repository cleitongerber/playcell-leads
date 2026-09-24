import { asc, eq } from "drizzle-orm";
import {
  leadSources,
  leadStatuses,
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
