import { and, eq, isNull } from "drizzle-orm";
import {
  campaigns,
  followUps,
  importTemplateFields,
  importTemplates,
  importTemplateVersions,
  leadSources,
  leadStatuses,
  leadTimelineEvents,
  leads,
  partners,
  pdvs,
  users,
} from "../../drizzle-v2/schema";
import type { PartnerContext } from "./access";
import {
  createCampaign,
  setCampaignFrozen,
  transitionCampaign,
} from "./campaignService";
import { getV2Db, type V2Database } from "./database";
import { completeFollowUp, createFollowUp } from "./followUpService";
import { updatePartnerGovernance } from "./governanceService";
import { mappingFingerprint, type ImportMapping } from "./importDomain";
import { saveCustomField } from "./importService";
import {
  addLeadNote,
  assumeLead,
  createLead,
  recordLeadContact,
} from "./leadService";
import { createPartner, writeV2Audit } from "./partnerService";
import { createPdv } from "./pdvService";
import { createPartnerUser } from "./userService";

/**
 * This seed is intentionally opt-in. It never runs from HTTP startup and only
 * creates records whose names/codes make their DEMO/HOMOLOGAÇÃO origin clear.
 */
const DEMO_CONFIRMATION = "PLAYCELL_V2_DEMO";
const DEMO_PARTNER_CODE = "demo-playcell";
const DEMO_PARTNER_NAME = "DEMO — Playcell Homologação";

type DemoSeedConfig = {
  superAdminEmail: string;
  demoPassword: string;
};

export function readV2DemoSeedConfig(
  environment: NodeJS.ProcessEnv = process.env
): DemoSeedConfig {
  if (environment.V2_DEMO_SEED_CONFIRM !== DEMO_CONFIRMATION) {
    throw new Error(
      "Seed de homologação bloqueado. Defina V2_DEMO_SEED_CONFIRM=PLAYCELL_V2_DEMO para executá-lo explicitamente."
    );
  }

  const superAdminEmail =
    environment.V2_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const demoPassword = environment.V2_DEMO_PASSWORD;
  if (!superAdminEmail) {
    throw new Error(
      "V2_SUPER_ADMIN_EMAIL é obrigatório. Execute pnpm bootstrap:v2 antes do seed de homologação."
    );
  }
  if (!demoPassword || demoPassword.length < 12) {
    throw new Error(
      "V2_DEMO_PASSWORD deve ser definido e ter no mínimo 12 caracteres."
    );
  }
  return { superAdminEmail, demoPassword };
}

function insertId(result: unknown) {
  return Number((result as [{ insertId?: number }])[0]?.insertId ?? 0);
}

async function ensurePartner(db: V2Database, superAdmin: { id: number }) {
  const existing = (
    await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.code, DEMO_PARTNER_CODE))
      .limit(1)
  )[0];
  if (existing) return existing.id;
  return createPartner(
    { userId: superAdmin.id, role: "super_admin" },
    { code: DEMO_PARTNER_CODE, name: DEMO_PARTNER_NAME }
  );
}

async function ensurePdv(
  db: V2Database,
  context: PartnerContext,
  input: { code: string; name: string; city: string; region: string }
) {
  const existing = (
    await db
      .select({ id: pdvs.id })
      .from(pdvs)
      .where(
        and(eq(pdvs.partnerId, context.partnerId), eq(pdvs.code, input.code))
      )
      .limit(1)
  )[0];
  return existing?.id ?? createPdv(context, input);
}

async function ensureCampaign(
  db: V2Database,
  context: PartnerContext,
  input: {
    code: string;
    name: string;
    description: string;
    pdvIds: number[];
    target: "draft" | "active" | "closed" | "archived";
    frozen?: boolean;
  }
) {
  const existing = (
    await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.partnerId, context.partnerId),
          eq(campaigns.code, input.code)
        )
      )
      .limit(1)
  )[0];
  if (existing) return existing.id;

  const campaignId = await createCampaign(context, {
    code: input.code,
    name: input.name,
    description: input.description,
    pdvIds: input.pdvIds,
  });
  if (input.target !== "draft") {
    await transitionCampaign(context, campaignId, "active");
  }
  if (input.frozen) await setCampaignFrozen(context, campaignId, true);
  if (input.target === "closed" || input.target === "archived") {
    await transitionCampaign(context, campaignId, "closed");
  }
  if (input.target === "archived") {
    await transitionCampaign(context, campaignId, "archived");
  }
  return campaignId;
}

async function ensureLead(
  db: V2Database,
  context: PartnerContext,
  input: {
    campaignId: number;
    pdvId: number;
    statusId: number;
    sourceId: number;
    name: string;
    phone: string;
    email: string;
    customData: Record<string, unknown>;
    receivedAt: Date;
  }
) {
  const normalizedPhone = input.phone.replace(/\D/g, "");
  const existing = (
    await db
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.partnerId, context.partnerId),
          eq(leads.campaignId, input.campaignId),
          eq(leads.normalizedPhone, normalizedPhone),
          isNull(leads.deletedAt)
        )
      )
      .limit(1)
  )[0];
  if (existing) return { id: existing.id, created: false };
  const id = await createLead(context, input);
  return { id, created: true };
}

async function seedOverdueFollowUp(
  db: V2Database,
  input: {
    partnerId: number;
    leadId: number;
    ownerMembershipId: number;
    dueAt: Date;
    note: string;
  }
) {
  const existing = (
    await db
      .select({ id: followUps.id })
      .from(followUps)
      .where(
        and(
          eq(followUps.partnerId, input.partnerId),
          eq(followUps.leadId, input.leadId),
          eq(followUps.note, input.note)
        )
      )
      .limit(1)
  )[0];
  if (existing) return existing.id;

  return db.transaction(async tx => {
    const followUpInsert = await tx.insert(followUps).values({
      partnerId: input.partnerId,
      leadId: input.leadId,
      ownerMembershipId: input.ownerMembershipId,
      dueAt: input.dueAt,
      note: input.note,
      status: "pending",
    });
    const followUpId = insertId(followUpInsert);
    if (!followUpId) throw new Error("Não foi possível criar follow-up DEMO");
    await tx
      .update(leads)
      .set({ nextFollowUpAt: input.dueAt, updatedAt: new Date() })
      .where(
        and(eq(leads.id, input.leadId), eq(leads.partnerId, input.partnerId))
      );
    await tx.insert(leadTimelineEvents).values({
      partnerId: input.partnerId,
      leadId: input.leadId,
      actorMembershipId: input.ownerMembershipId,
      type: "follow_up_created",
      occurredAt: input.dueAt,
      payloadJson: {
        followUpId,
        ownerMembershipId: input.ownerMembershipId,
        dueAt: input.dueAt.toISOString(),
        note: input.note,
        seededFor: "overdue_demo",
      },
      visibility: "partner",
    });
    return followUpId;
  });
}

const demoTemplateMappings: ImportMapping[] = [
  {
    sourceHeader: "NOME CLIENTE",
    targetKind: "core",
    targetKey: "name",
    valueType: "text",
    isRequired: true,
  },
  {
    sourceHeader: "CELULAR",
    targetKind: "core",
    targetKey: "phone",
    valueType: "text",
    isRequired: true,
    transformKey: "digits_only",
  },
  {
    sourceHeader: "E-MAIL",
    targetKind: "core",
    targetKey: "email",
    valueType: "text",
    isRequired: false,
  },
  {
    sourceHeader: "DOCUMENTO",
    targetKind: "custom",
    targetKey: "documento",
    valueType: "text",
    isRequired: false,
  },
  {
    sourceHeader: "PRODUTO",
    targetKind: "custom",
    targetKey: "produto",
    valueType: "text",
    isRequired: false,
  },
];

async function ensureImportTemplate(
  db: V2Database,
  context: PartnerContext,
  createdByMembershipId: number
) {
  const templateName = "DEMO — Contatos comerciais CSV";
  let template = (
    await db
      .select({ id: importTemplates.id })
      .from(importTemplates)
      .where(
        and(
          eq(importTemplates.partnerId, context.partnerId),
          eq(importTemplates.name, templateName)
        )
      )
      .limit(1)
  )[0];
  if (!template) {
    const inserted = await db.insert(importTemplates).values({
      partnerId: context.partnerId,
      name: templateName,
      entityType: "lead",
      createdByMembershipId,
    });
    const templateId = insertId(inserted);
    if (!templateId) throw new Error("Não foi possível criar template DEMO");
    template = { id: templateId };
    await writeV2Audit(db, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "demo_import_template_created",
      entityType: "import_template",
      entityId: templateId,
      metadata: { demo: true },
    });
  }

  const version = (
    await db
      .select({ id: importTemplateVersions.id })
      .from(importTemplateVersions)
      .where(
        and(
          eq(importTemplateVersions.partnerId, context.partnerId),
          eq(importTemplateVersions.templateId, template.id),
          eq(importTemplateVersions.versionNumber, 1)
        )
      )
      .limit(1)
  )[0];
  if (version) return version.id;

  return db.transaction(async tx => {
    const inserted = await tx.insert(importTemplateVersions).values({
      partnerId: context.partnerId,
      templateId: template.id,
      versionNumber: 1,
      mappingFingerprint: mappingFingerprint(demoTemplateMappings),
      createdByMembershipId,
    });
    const versionId = insertId(inserted);
    if (!versionId) throw new Error("Não foi possível criar versão DEMO");
    await tx.insert(importTemplateFields).values(
      demoTemplateMappings.map((mapping, sortOrder) => ({
        partnerId: context.partnerId,
        templateVersionId: versionId,
        sourceHeader: mapping.sourceHeader,
        targetKind: mapping.targetKind,
        targetKey: mapping.targetKey,
        valueType: mapping.valueType,
        isRequired: mapping.isRequired,
        transformKey: mapping.transformKey ?? null,
        sortOrder,
      }))
    );
    await writeV2Audit(tx as unknown as V2Database, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "demo_import_template_version_created",
      entityType: "import_template_version",
      entityId: versionId,
      metadata: { demo: true, versionNumber: 1 },
    });
    return versionId;
  });
}

export async function seedV2DemoData(config = readV2DemoSeedConfig()) {
  const db = await getV2Db();
  const superAdmin = (
    await db
      .select({
        id: users.id,
        systemRole: users.systemRole,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.email, config.superAdminEmail))
      .limit(1)
  )[0];
  if (!superAdmin?.isActive || superAdmin.systemRole !== "super_admin") {
    throw new Error(
      "Super Admin V2 não encontrado ou inativo. Execute pnpm bootstrap:v2 antes do seed."
    );
  }

  const partnerId = await ensurePartner(db, superAdmin);
  const superAdminContext: PartnerContext = {
    partnerId,
    membershipId: null,
    role: "super_admin",
    userId: superAdmin.id,
  };

  const [videiraPdvId, fraiburgoPdvId, cacadorPdvId] = await Promise.all([
    ensurePdv(db, superAdminContext, {
      code: "demo-videira",
      name: "DEMO — PDV Videira",
      city: "Videira",
      region: "Meio-Oeste",
    }),
    ensurePdv(db, superAdminContext, {
      code: "demo-fraiburgo",
      name: "DEMO — PDV Fraiburgo",
      city: "Fraiburgo",
      region: "Meio-Oeste",
    }),
    ensurePdv(db, superAdminContext, {
      code: "demo-cacador",
      name: "DEMO — PDV Caçador",
      city: "Caçador",
      region: "Meio-Oeste",
    }),
  ]);

  const partnerAdmin = await createPartnerUser(superAdminContext, {
    name: "Admin DEMO",
    email: "admin.demo@playcell.example",
    password: config.demoPassword,
    role: "partner_admin",
    pdvIds: [videiraPdvId, fraiburgoPdvId, cacadorPdvId],
  });
  const manager = await createPartnerUser(superAdminContext, {
    name: "Gestor DEMO",
    email: "gestor.demo@playcell.example",
    password: config.demoPassword,
    role: "manager",
    pdvIds: [videiraPdvId, fraiburgoPdvId, cacadorPdvId],
  });
  const sellerOne = await createPartnerUser(superAdminContext, {
    name: "Vendedor DEMO 1",
    email: "vendedor1.demo@playcell.example",
    password: config.demoPassword,
    role: "seller",
    pdvIds: [videiraPdvId, fraiburgoPdvId],
  });
  const sellerTwo = await createPartnerUser(superAdminContext, {
    name: "Vendedor DEMO 2",
    email: "vendedor2.demo@playcell.example",
    password: config.demoPassword,
    role: "seller",
    pdvIds: [cacadorPdvId],
  });

  const sellerOneContext: PartnerContext = {
    partnerId,
    membershipId: sellerOne.membershipId,
    role: "seller",
    userId: sellerOne.userId,
  };
  const sellerTwoContext: PartnerContext = {
    partnerId,
    membershipId: sellerTwo.membershipId,
    role: "seller",
    userId: sellerTwo.userId,
  };

  const activeCampaignId = await ensureCampaign(db, superAdminContext, {
    code: "demo-ativa",
    name: "DEMO — Campanha ativa",
    description: "Base fictícia para homologação operacional da V2.",
    pdvIds: [videiraPdvId, fraiburgoPdvId, cacadorPdvId],
    target: "active",
  });
  await ensureCampaign(db, superAdminContext, {
    code: "demo-rascunho",
    name: "DEMO — Campanha em rascunho",
    description: "Exemplo fictício de campanha ainda não ativada.",
    pdvIds: [videiraPdvId],
    target: "draft",
  });
  await ensureCampaign(db, superAdminContext, {
    code: "demo-congelada",
    name: "DEMO — Campanha congelada",
    description: "Exemplo fictício de bloqueio temporário de operações.",
    pdvIds: [fraiburgoPdvId],
    target: "active",
    frozen: true,
  });
  await ensureCampaign(db, superAdminContext, {
    code: "demo-encerrada",
    name: "DEMO — Campanha encerrada",
    description: "Exemplo fictício de campanha concluída.",
    pdvIds: [cacadorPdvId],
    target: "closed",
  });
  await ensureCampaign(db, superAdminContext, {
    code: "demo-arquivada",
    name: "DEMO — Campanha arquivada",
    description: "Exemplo fictício de campanha arquivada logicamente.",
    pdvIds: [videiraPdvId],
    target: "archived",
  });

  await updatePartnerGovernance(superAdminContext, {
    evidenceRequired: false,
    noteRequired: false,
    followUpRequired: false,
    allowedChannels: ["whatsapp", "telefone", "email"],
    allowedOutcomes: ["interessado", "sem_resposta", "agendado", "convertido"],
    allowedEvidenceMimeTypes: ["image/png", "image/jpeg", "application/pdf"],
    maxEvidenceSizeBytes: 5 * 1024 * 1024,
    retentionDays: 365,
  });
  await saveCustomField(superAdminContext, {
    key: "documento",
    label: "Documento DEMO",
    fieldType: "text",
    isRequired: false,
    isActive: true,
    sortOrder: 10,
  });
  await saveCustomField(superAdminContext, {
    key: "produto",
    label: "Produto de interesse",
    fieldType: "select",
    options: ["Plano DEMO", "Acessório DEMO"],
    isRequired: false,
    isActive: true,
    sortOrder: 20,
  });

  const [statusRows, sourceRows] = await Promise.all([
    db
      .select({ id: leadStatuses.id, code: leadStatuses.code })
      .from(leadStatuses)
      .where(eq(leadStatuses.partnerId, partnerId)),
    db
      .select({ id: leadSources.id, code: leadSources.code })
      .from(leadSources)
      .where(eq(leadSources.partnerId, partnerId)),
  ]);
  const statusId = new Map(statusRows.map(row => [row.code, row.id]));
  const sourceId = new Map(sourceRows.map(row => [row.code, row.id]));
  const requiredStatus = (code: string) => {
    const id = statusId.get(code);
    if (!id) throw new Error(`Status DEMO ausente: ${code}`);
    return id;
  };
  const requiredSource = (code: string) => {
    const id = sourceId.get(code);
    if (!id) throw new Error(`Fonte DEMO ausente: ${code}`);
    return id;
  };

  const now = new Date();
  const available = await ensureLead(db, superAdminContext, {
    campaignId: activeCampaignId,
    pdvId: videiraPdvId,
    statusId: requiredStatus("new"),
    sourceId: requiredSource("import"),
    name: "Cliente DEMO Disponível",
    phone: "(47) 90000-1001",
    email: "disponivel@demo.example",
    customData: {
      documento: "DEMO-001",
      produto: "Plano DEMO",
      demoSeed: true,
    },
    receivedAt: new Date(now.getTime() - 20 * 60 * 1000),
  });
  const overdue = await ensureLead(db, superAdminContext, {
    campaignId: activeCampaignId,
    pdvId: videiraPdvId,
    statusId: requiredStatus("new"),
    sourceId: requiredSource("manual"),
    name: "Cliente DEMO Vencido",
    phone: "(47) 90000-1002",
    email: "vencido@demo.example",
    customData: {
      documento: "DEMO-002",
      produto: "Plano DEMO",
      demoSeed: true,
    },
    receivedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
  });
  const upcoming = await ensureLead(db, superAdminContext, {
    campaignId: activeCampaignId,
    pdvId: fraiburgoPdvId,
    statusId: requiredStatus("new"),
    sourceId: requiredSource("import"),
    name: "Cliente DEMO Próximo",
    phone: "(47) 90000-1003",
    email: "proximo@demo.example",
    customData: {
      documento: "DEMO-003",
      produto: "Acessório DEMO",
      demoSeed: true,
    },
    receivedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
  });
  const today = await ensureLead(db, superAdminContext, {
    campaignId: activeCampaignId,
    pdvId: cacadorPdvId,
    statusId: requiredStatus("new"),
    sourceId: requiredSource("manual"),
    name: "Cliente DEMO Hoje",
    phone: "(47) 90000-1004",
    email: "hoje@demo.example",
    customData: {
      documento: "DEMO-004",
      produto: "Plano DEMO",
      demoSeed: true,
    },
    receivedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
  });
  const completed = await ensureLead(db, superAdminContext, {
    campaignId: activeCampaignId,
    pdvId: cacadorPdvId,
    statusId: requiredStatus("new"),
    sourceId: requiredSource("manual"),
    name: "Cliente DEMO Concluído",
    phone: "(47) 90000-1005",
    email: "concluido@demo.example",
    customData: {
      documento: "DEMO-005",
      produto: "Acessório DEMO",
      demoSeed: true,
    },
    receivedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
  });

  if (overdue.created) {
    await assumeLead(sellerOneContext, overdue.id);
    await recordLeadContact(sellerOneContext, overdue.id, {
      channel: "whatsapp",
      outcome: "sem_resposta",
      summary: "Contato DEMO sem resposta; retorno pendente.",
      statusId: requiredStatus("contacted"),
    });
    await seedOverdueFollowUp(db, {
      partnerId,
      leadId: overdue.id,
      ownerMembershipId: sellerOne.membershipId,
      dueAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      note: "DEMO — retorno vencido",
    });
  }
  if (upcoming.created) {
    await assumeLead(sellerOneContext, upcoming.id);
    await recordLeadContact(sellerOneContext, upcoming.id, {
      channel: "telefone",
      outcome: "interessado",
      summary: "Cliente DEMO interessado; próximo contato programado.",
      statusId: requiredStatus("qualified"),
      followUpDueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      followUpNote: "DEMO — enviar proposta",
    });
    await addLeadNote(
      sellerOneContext,
      upcoming.id,
      "Nota DEMO: cliente pediu comparação de planos."
    );
  }
  if (today.created) {
    await assumeLead(sellerTwoContext, today.id);
    await addLeadNote(
      sellerTwoContext,
      today.id,
      "Nota DEMO: solicitar melhor horário para ligação."
    );
    await createFollowUp(sellerTwoContext, {
      leadId: today.id,
      dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      note: "DEMO — follow-up para hoje",
    });
  }
  if (completed.created) {
    await assumeLead(sellerTwoContext, completed.id);
    await recordLeadContact(sellerTwoContext, completed.id, {
      channel: "email",
      outcome: "convertido",
      summary: "Conversão DEMO registrada para exibir a timeline concluída.",
      statusId: requiredStatus("converted"),
    });
    const completedFollowUpId = await createFollowUp(sellerTwoContext, {
      leadId: completed.id,
      dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      note: "DEMO — tarefa concluída",
    });
    await completeFollowUp(sellerTwoContext, completedFollowUpId);
  }

  const templateVersionId = await ensureImportTemplate(
    db,
    superAdminContext,
    partnerAdmin.membershipId
  );
  await writeV2Audit(db, {
    partnerId,
    actorUserId: superAdmin.id,
    action: "demo_seed_completed",
    entityType: "partner",
    entityId: partnerId,
    metadata: {
      demo: true,
      campaignId: activeCampaignId,
      templateVersionId,
      availableLeadId: available.id,
      managerMembershipId: manager.membershipId,
    },
  });

  return {
    partnerId,
    partnerCode: DEMO_PARTNER_CODE,
    campaignId: activeCampaignId,
    templateVersionId,
    createdLeads: [available, overdue, upcoming, today, completed].filter(
      lead => lead.created
    ).length,
  };
}
