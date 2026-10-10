import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  campaigns,
  leads,
  partnerSalesScriptLibraries,
  salesScriptCampaigns,
  salesScripts,
  salesScriptCategory,
  salesScriptScope,
} from "../../drizzle-v2/schema";
import {
  type PartnerContext,
  requirePartnerRole,
} from "./access";
import { getV2Db, type V2Database } from "./database";
import { resolvePdvScope } from "./pdvScope";
import { writeV2Audit } from "./partnerService";

export type SalesScriptCategory = (typeof salesScriptCategory)[number];
export type SalesScriptScope = (typeof salesScriptScope)[number];

export type SalesScriptInput = {
  title: string;
  category: SalesScriptCategory;
  content: string;
  scope: SalesScriptScope;
  campaignIds?: number[];
  sortOrder?: number;
};

const MAX_CONTENT_LENGTH = 5_000;
const SUGGESTED_LIBRARY_VERSION = "v1";

const suggestedScripts: Array<
  Pick<SalesScriptInput, "title" | "category" | "content" | "scope"> & {
    sortOrder: number;
  }
> = [
  { title: "Apresentação inicial", category: "opening", content: "Olá! Sou da equipe responsável pelo seu atendimento. Posso entender rapidamente o que você procura?", scope: "all_campaigns", sortOrder: 10 },
  { title: "Permissão para conversar", category: "opening", content: "Este é um bom momento para falarmos por alguns minutos sobre sua necessidade?", scope: "all_campaigns", sortOrder: 20 },
  { title: "Objetivo principal", category: "discovery", content: "Para eu orientar melhor, qual resultado você espera alcançar neste momento?", scope: "all_campaigns", sortOrder: 10 },
  { title: "Contexto atual", category: "discovery", content: "Como vocês resolvem isso hoje? O que funciona bem e o que ainda gera dificuldade?", scope: "all_campaigns", sortOrder: 20 },
  { title: "Prioridade", category: "discovery", content: "Qual é a prioridade desse tema para você agora?", scope: "all_campaigns", sortOrder: 30 },
  { title: "Critério de decisão", category: "discovery", content: "O que será mais importante para você ao avaliar uma solução?", scope: "all_campaigns", sortOrder: 40 },
  { title: "Conexão com a necessidade", category: "offer", content: "Pelo que você comentou, acredito que esta alternativa pode ajudar principalmente em [benefício relevante].", scope: "all_campaigns", sortOrder: 10 },
  { title: "Próximo passo da proposta", category: "offer", content: "Posso apresentar uma opção alinhada ao que você precisa e tirar suas dúvidas?", scope: "all_campaigns", sortOrder: 20 },
  { title: "Objeção de tempo", category: "objections", content: "Entendo. O que precisaria acontecer para que esse assunto fizesse sentido em outro momento?", scope: "all_campaigns", sortOrder: 10 },
  { title: "Objeção de comparação", category: "objections", content: "Faz sentido comparar. Quais critérios você quer usar para decidir com segurança?", scope: "all_campaigns", sortOrder: 20 },
  { title: "Objeção de valor", category: "objections", content: "Além do investimento, qual impacto ou resultado você precisa considerar nessa decisão?", scope: "all_campaigns", sortOrder: 30 },
  { title: "Confirmação de interesse", category: "closing", content: "Pelo que conversamos, esta opção atende ao que você buscava?", scope: "all_campaigns", sortOrder: 10 },
  { title: "Combinar próximo passo", category: "closing", content: "Qual é o melhor próximo passo para avançarmos com clareza?", scope: "all_campaigns", sortOrder: 20 },
  { title: "Retomada cordial", category: "follow_up", content: "Olá! Retomando nossa conversa para saber se ainda faz sentido seguirmos com este assunto.", scope: "all_campaigns", sortOrder: 10 },
  { title: "Retomada com contexto", category: "follow_up", content: "Ficou alguma dúvida ou ponto pendente da nossa última conversa que eu possa ajudar a esclarecer?", scope: "all_campaigns", sortOrder: 20 },
];

function cleanText(value: string, field: string, limit: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} é obrigatório`);
  if (normalized.length > limit) throw new Error(`${field} excede o limite permitido`);
  return normalized;
}

function normalizeInput(input: SalesScriptInput) {
  const campaignIds = Array.from(new Set(input.campaignIds ?? []));
  if (input.scope === "all_campaigns" && campaignIds.length) {
    throw new Error("Scripts para todas as campanhas não podem selecionar campanhas específicas");
  }
  if (input.scope === "specific_campaigns" && !campaignIds.length) {
    throw new Error("Selecione ao menos uma campanha para este script");
  }
  return {
    title: cleanText(input.title, "Título", 160),
    content: cleanText(input.content, "Mensagem", MAX_CONTENT_LENGTH),
    category: input.category,
    scope: input.scope,
    campaignIds,
    sortOrder: Number.isInteger(input.sortOrder) ? Math.max(0, input.sortOrder!) : 0,
  };
}

async function validateCampaignIds(
  db: V2Database,
  context: PartnerContext,
  campaignIds: number[]
) {
  if (!campaignIds.length) return;
  const found = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.partnerId, context.partnerId), inArray(campaigns.id, campaignIds)));
  if (found.length !== campaignIds.length) {
    throw new Error("Uma ou mais campanhas não pertencem ao parceiro atual");
  }
}

async function getScriptInPartner(
  db: V2Database,
  context: PartnerContext,
  id: number
) {
  const script = (await db.select().from(salesScripts).where(and(eq(salesScripts.id, id), eq(salesScripts.partnerId, context.partnerId))).limit(1))[0];
  if (!script) throw new Error("Script não encontrado");
  return script;
}

async function replaceCampaignScope(
  db: V2Database,
  context: PartnerContext,
  scriptId: number,
  campaignIds: number[]
) {
  await db.delete(salesScriptCampaigns).where(and(eq(salesScriptCampaigns.partnerId, context.partnerId), eq(salesScriptCampaigns.salesScriptId, scriptId)));
  if (campaignIds.length) {
    await db.insert(salesScriptCampaigns).values(campaignIds.map(campaignId => ({
      partnerId: context.partnerId,
      salesScriptId: scriptId,
      campaignId,
    })));
  }
}

async function campaignDetailsByScript(db: V2Database, partnerId: number, scriptIds: number[]) {
  if (!scriptIds.length) return new Map<number, Array<{ id: number; name: string }>>();
  const rows = await db
    .select({ scriptId: salesScriptCampaigns.salesScriptId, id: campaigns.id, name: campaigns.name })
    .from(salesScriptCampaigns)
    .innerJoin(campaigns, and(eq(campaigns.id, salesScriptCampaigns.campaignId), eq(campaigns.partnerId, salesScriptCampaigns.partnerId)))
    .where(and(eq(salesScriptCampaigns.partnerId, partnerId), inArray(salesScriptCampaigns.salesScriptId, scriptIds)))
    .orderBy(asc(campaigns.name));
  const byScript = new Map<number, Array<{ id: number; name: string }>>();
  for (const row of rows) byScript.set(row.scriptId, [...(byScript.get(row.scriptId) ?? []), { id: row.id, name: row.name }]);
  return byScript;
}

function serializeScripts(rows: Array<typeof salesScripts.$inferSelect>, details: Map<number, Array<{ id: number; name: string }>>) {
  return rows.map(row => ({ ...row, campaigns: details.get(row.id) ?? [] }));
}

/** Administration list. Campaign filtering means "available to this campaign", including globals. */
export async function listSalesScripts(
  context: PartnerContext,
  input?: { category?: SalesScriptCategory; campaignId?: number }
) {
  requirePartnerRole(context, ["partner_admin", "super_admin"]);
  const db = await getV2Db();
  if (input?.campaignId) await validateCampaignIds(db, context, [input.campaignId]);
  const associations = input?.campaignId
    ? db.select({ scriptId: salesScriptCampaigns.salesScriptId }).from(salesScriptCampaigns).where(and(eq(salesScriptCampaigns.partnerId, context.partnerId), eq(salesScriptCampaigns.campaignId, input.campaignId)))
    : null;
  const conditions = [eq(salesScripts.partnerId, context.partnerId)];
  if (input?.category) conditions.push(eq(salesScripts.category, input.category));
  if (associations) conditions.push(or(eq(salesScripts.scope, "all_campaigns"), inArray(salesScripts.id, associations))!);
  const rows = await db.select().from(salesScripts).where(and(...conditions)).orderBy(asc(salesScripts.category), asc(salesScripts.sortOrder), asc(salesScripts.title));
  const details = await campaignDetailsByScript(db, context.partnerId, rows.map(row => row.id));
  const seeded = Boolean((await db.select({ id: partnerSalesScriptLibraries.id }).from(partnerSalesScriptLibraries).where(eq(partnerSalesScriptLibraries.partnerId, context.partnerId)).limit(1))[0]);
  return { scripts: serializeScripts(rows, details), suggestedLibraryAdded: seeded };
}

export async function createSalesScript(context: PartnerContext, input: SalesScriptInput) {
  requirePartnerRole(context, ["partner_admin", "super_admin"]);
  const values = normalizeInput(input);
  const db = await getV2Db();
  await validateCampaignIds(db, context, values.campaignIds);
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const inserted = await tx.insert(salesScripts).values({ partnerId: context.partnerId, title: values.title, category: values.category, content: values.content, scope: values.scope, sortOrder: values.sortOrder });
    const id = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId);
    if (!id) throw new Error("Não foi possível criar o script");
    await replaceCampaignScope(transactionDb, context, id, values.campaignIds);
    await writeV2Audit(transactionDb, { partnerId: context.partnerId, actorUserId: context.userId, actorMembershipId: context.membershipId, action: "sales_script_created", entityType: "sales_script", entityId: id, metadata: { category: values.category, scope: values.scope, campaignCount: values.campaignIds.length, contentLength: values.content.length } });
    return { id };
  });
}

export async function updateSalesScript(context: PartnerContext, id: number, input: SalesScriptInput) {
  requirePartnerRole(context, ["partner_admin", "super_admin"]);
  const values = normalizeInput(input);
  const db = await getV2Db();
  await getScriptInPartner(db, context, id);
  await validateCampaignIds(db, context, values.campaignIds);
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx.update(salesScripts).set({ title: values.title, category: values.category, content: values.content, scope: values.scope, sortOrder: values.sortOrder, updatedAt: new Date() }).where(and(eq(salesScripts.id, id), eq(salesScripts.partnerId, context.partnerId)));
    await replaceCampaignScope(transactionDb, context, id, values.campaignIds);
    await writeV2Audit(transactionDb, { partnerId: context.partnerId, actorUserId: context.userId, actorMembershipId: context.membershipId, action: "sales_script_updated", entityType: "sales_script", entityId: id, metadata: { category: values.category, scope: values.scope, campaignCount: values.campaignIds.length, contentLength: values.content.length } });
  });
}

export async function deleteSalesScript(context: PartnerContext, id: number) {
  requirePartnerRole(context, ["partner_admin", "super_admin"]);
  const db = await getV2Db();
  await getScriptInPartner(db, context, id);
  await db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    await tx.delete(salesScriptCampaigns).where(and(eq(salesScriptCampaigns.partnerId, context.partnerId), eq(salesScriptCampaigns.salesScriptId, id)));
    await tx.delete(salesScripts).where(and(eq(salesScripts.id, id), eq(salesScripts.partnerId, context.partnerId)));
    await writeV2Audit(transactionDb, { partnerId: context.partnerId, actorUserId: context.userId, actorMembershipId: context.membershipId, action: "sales_script_deleted", entityType: "sales_script", entityId: id });
  });
}

/** Read-only Lead-oriented query. campaignId is always derived from the authorized Lead. */
export async function listSalesScriptsForLead(context: PartnerContext, leadId: number) {
  const db = await getV2Db();
  const lead = (await db.select({ id: leads.id, pdvId: leads.pdvId, campaignId: leads.campaignId, assignedMembershipId: leads.assignedMembershipId }).from(leads).where(and(eq(leads.id, leadId), eq(leads.partnerId, context.partnerId), isNull(leads.deletedAt))).limit(1))[0];
  if (!lead) throw new Error("Lead não encontrado");
  const scope = await resolvePdvScope(db, context);
  if (scope && !scope.includes(lead.pdvId)) throw new Error("Lead não encontrado");
  if (context.role === "seller" && lead.assignedMembershipId !== null && lead.assignedMembershipId !== context.membershipId) throw new Error("Lead não encontrado");
  const rows = await db
    .select()
    .from(salesScripts)
    .leftJoin(salesScriptCampaigns, and(eq(salesScriptCampaigns.salesScriptId, salesScripts.id), eq(salesScriptCampaigns.partnerId, salesScripts.partnerId), eq(salesScriptCampaigns.campaignId, lead.campaignId)))
    .where(and(eq(salesScripts.partnerId, context.partnerId), or(eq(salesScripts.scope, "all_campaigns"), eq(salesScriptCampaigns.campaignId, lead.campaignId))))
    .orderBy(asc(salesScripts.category), asc(salesScripts.sortOrder), asc(salesScripts.title));
  return rows.map(row => row.sales_scripts);
}

/** Explicit only: no migration, deploy or read path ever invokes this. */
export async function materializeSuggestedSalesScripts(context: PartnerContext) {
  requirePartnerRole(context, ["partner_admin", "super_admin"]);
  const db = await getV2Db();
  const existing = (await db.select({ id: partnerSalesScriptLibraries.id }).from(partnerSalesScriptLibraries).where(eq(partnerSalesScriptLibraries.partnerId, context.partnerId)).limit(1))[0];
  if (existing) return { created: false, count: 0 };
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const alreadySeeded = (await transactionDb.select({ id: partnerSalesScriptLibraries.id }).from(partnerSalesScriptLibraries).where(eq(partnerSalesScriptLibraries.partnerId, context.partnerId)).limit(1))[0];
    if (alreadySeeded) return { created: false, count: 0 };
    await tx.insert(partnerSalesScriptLibraries).values({ partnerId: context.partnerId, seedVersion: SUGGESTED_LIBRARY_VERSION });
    await tx.insert(salesScripts).values(suggestedScripts.map(script => ({ ...script, partnerId: context.partnerId })));
    await writeV2Audit(transactionDb, { partnerId: context.partnerId, actorUserId: context.userId, actorMembershipId: context.membershipId, action: "sales_script_suggested_library_materialized", entityType: "partner_sales_script_library", entityId: context.partnerId, metadata: { version: SUGGESTED_LIBRARY_VERSION, count: suggestedScripts.length } });
    return { created: true, count: suggestedScripts.length };
  });
}
