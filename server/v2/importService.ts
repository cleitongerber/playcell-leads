import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  campaignImportPolicies,
  campaignPdvs,
  campaigns,
  customFieldDefinitions,
  importTemplateFields,
  importTemplates,
  importTemplateVersions,
  leadImportBatches,
  leadImportIssues,
  leadImportRows,
  leadSources,
  leadStatuses,
  leadTimelineEvents,
  leads,
  partnerImportPolicies,
  pdvs,
  userPdvAssignments,
  users,
  userPartners,
  type CustomFieldType,
  type DuplicateMatchStrategy,
  type DuplicatePolicy,
  type ImportBatchStatus,
  type ImportRowStatus,
} from "../../drizzle-v2/schema";
import { type PartnerContext } from "./access";
import { parseImportCsv } from "./csvImport";
import {
  canCreateImportForCampaign,
  defaultDuplicatePolicy,
  duplicateIsMatch,
  mapImportRow,
  mappingFingerprint,
  normalizeEmail,
  normalizeSafeUpdateFields,
  validateImportMappings,
  type ImportCustomField,
  type ImportMapping,
  type MappedLeadRow,
} from "./importDomain";
import { getV2Db, type V2Database } from "./database";
import { writeV2Audit } from "./partnerService";

const CHUNK_SIZE = 250;
const PAGE_MAX = 100;

type DbCampaign = typeof campaigns.$inferSelect;
type DbPdv = typeof pdvs.$inferSelect;
type DbBatch = typeof leadImportBatches.$inferSelect;
type MappedStorageRow = Omit<MappedLeadRow, "receivedAt"> & {
  pdvId: number;
  sourceId: number | null;
  receivedAt: string | null;
};

export type CustomFieldInput = {
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options?: string[] | null;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type ImportPolicyInput = {
  policy: DuplicatePolicy;
  matchStrategy: DuplicateMatchStrategy;
  safeUpdateFields?: string[] | null;
};

export type ImportValidationInput = {
  batchId: number;
  mappings: ImportMapping[];
  templateId?: number | null;
  saveTemplateName?: string | null;
};

type CampaignImportScope = {
  campaign: DbCampaign;
  pdvs: DbPdv[];
  accessiblePdvIds: number[] | null;
};

function asInsertId(result: unknown) {
  return Number((result as [{ insertId?: number }])[0]?.insertId ?? 0);
}

function asAffectedRows(result: unknown) {
  const header = (result as [{ affectedRows?: number }])[0];
  return Number(header?.affectedRows ?? 0);
}

function chunk<T>(values: readonly T[], size = CHUNK_SIZE) {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

function normalizeReference(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeFieldKey(value: string) {
  const key = normalizeReference(value).replace(/-/g, "_");
  if (!key || key.length > 96) throw new Error("Chave do campo inválida");
  return key;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readTextRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      typeof item === "string" ? item : "",
    ])
  );
}

function readJsonRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseMappedRow(value: unknown): MappedStorageRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.pdvId !== "number" || !Number.isInteger(row.pdvId))
    return null;
  const customData =
    row.customData &&
    typeof row.customData === "object" &&
    !Array.isArray(row.customData)
      ? (row.customData as Record<string, unknown>)
      : {};
  return {
    name: typeof row.name === "string" ? row.name : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    normalizedPhone:
      typeof row.normalizedPhone === "string" ? row.normalizedPhone : null,
    email: typeof row.email === "string" ? row.email : null,
    normalizedEmail:
      typeof row.normalizedEmail === "string" ? row.normalizedEmail : null,
    sourceValue: null,
    pdvValue: null,
    sourceId: typeof row.sourceId === "number" ? row.sourceId : null,
    pdvId: row.pdvId,
    receivedAt: typeof row.receivedAt === "string" ? row.receivedAt : null,
    customData,
  };
}

function outputBatch(batch: DbBatch) {
  return {
    id: batch.id,
    campaignId: batch.campaignId,
    templateVersionId: batch.templateVersionId,
    targetPdvId: batch.targetPdvId,
    fileName: batch.fileName,
    fileSizeBytes: batch.fileSizeBytes,
    delimiter: batch.delimiter,
    headers: readStringArray(batch.headersJson),
    duplicatePolicy: batch.duplicatePolicy,
    duplicateMatchStrategy: batch.duplicateMatchStrategy,
    safeUpdateFields: normalizeSafeUpdateFields(batch.safeUpdateFields),
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    invalidRows: batch.invalidRows,
    importedRows: batch.importedRows,
    duplicateRows: batch.duplicateRows,
    rejectedRows: batch.rejectedRows,
    updatedRows: batch.updatedRows,
    status: batch.status,
    errorSummary: batch.errorSummary,
    confirmedAt: batch.confirmedAt,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

async function scopedPdvIds(db: V2Database, context: PartnerContext) {
  if (context.role === "super_admin" || context.role === "partner_admin")
    return null;
  const assignments = await db
    .select({ pdvId: userPdvAssignments.pdvId })
    .from(userPdvAssignments)
    .where(
      and(
        eq(userPdvAssignments.partnerId, context.partnerId),
        eq(userPdvAssignments.membershipId, context.membershipId!),
        eq(userPdvAssignments.isActive, true)
      )
    );
  return assignments.map(row => row.pdvId);
}

async function getCampaignImportScope(
  db: V2Database,
  context: PartnerContext,
  campaignId: number,
  requireOperationalState = true
): Promise<CampaignImportScope> {
  const campaign = (
    await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.partnerId, context.partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!campaign) throw new Error("Campanha não encontrada");
  if (
    requireOperationalState &&
    !canCreateImportForCampaign({
      status: campaign.status,
      isFrozen: campaign.isFrozen,
    })
  ) {
    throw new Error("Esta campanha não aceita novas importações");
  }
  const campaignPdvConditions = [
    eq(campaignPdvs.partnerId, context.partnerId),
    eq(campaignPdvs.campaignId, campaignId),
  ];
  if (requireOperationalState) {
    campaignPdvConditions.push(eq(campaignPdvs.isActive, true));
    campaignPdvConditions.push(eq(pdvs.isActive, true));
  }
  const campaignPdvsRows = await db
    .select({ pdv: pdvs })
    .from(campaignPdvs)
    .innerJoin(pdvs, eq(pdvs.id, campaignPdvs.pdvId))
    .where(and(...campaignPdvConditions));
  const campaignPdvsList = campaignPdvsRows.map(row => row.pdv);
  if (requireOperationalState && !campaignPdvsList.length)
    throw new Error("A campanha não possui PDV ativo para importação");
  const accessiblePdvIds = await scopedPdvIds(db, context);
  if (
    accessiblePdvIds &&
    !campaignPdvsList.some(pdv => accessiblePdvIds.includes(pdv.id))
  ) {
    throw new Error("Campanha não encontrada");
  }
  return { campaign, pdvs: campaignPdvsList, accessiblePdvIds };
}

function resolvePdv(
  value: string | null,
  scope: CampaignImportScope,
  fixedPdvId: number | null
): { pdvId?: number; issue?: { code: string; details: string } } {
  if (fixedPdvId) return { pdvId: fixedPdvId };
  if (!value) {
    if (scope.pdvs.length === 1) return { pdvId: scope.pdvs[0].id };
    return {
      issue: {
        code: "pdv_required",
        details: "Selecione um PDV para o arquivo ou mapeie uma coluna de PDV.",
      },
    };
  }
  const key = normalizeReference(value);
  const matches = scope.pdvs.filter(
    pdv =>
      normalizeReference(pdv.code) === key ||
      normalizeReference(pdv.name) === key
  );
  if (matches.length !== 1) {
    return {
      issue: {
        code: matches.length ? "pdv_ambiguous" : "pdv_invalid",
        details:
          matches.length > 1
            ? "A referência de PDV é ambígua na campanha."
            : "O PDV informado não está ativo ou não participa da campanha.",
      },
    };
  }
  if (
    scope.accessiblePdvIds &&
    !scope.accessiblePdvIds.includes(matches[0].id)
  ) {
    return {
      issue: {
        code: "pdv_not_allowed",
        details: "Você não possui acesso ao PDV desta linha.",
      },
    };
  }
  return { pdvId: matches[0].id };
}

async function listImportCustomFields(db: V2Database, partnerId: number) {
  const rows = await db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.partnerId, partnerId),
        eq(customFieldDefinitions.entityType, "lead")
      )
    )
    .orderBy(
      asc(customFieldDefinitions.sortOrder),
      asc(customFieldDefinitions.label)
    );
  return rows.map(
    row =>
      ({
        key: row.key,
        label: row.label,
        fieldType: row.fieldType,
        isRequired: row.isRequired,
        isActive: row.isActive,
        options: row.optionsJson ? readStringArray(row.optionsJson) : null,
      }) satisfies ImportCustomField
  );
}

async function resolveImportPolicy(
  db: V2Database,
  partnerId: number,
  campaignId: number
) {
  const [campaignPolicy, partnerPolicy] = await Promise.all([
    db
      .select()
      .from(campaignImportPolicies)
      .where(
        and(
          eq(campaignImportPolicies.partnerId, partnerId),
          eq(campaignImportPolicies.campaignId, campaignId)
        )
      )
      .limit(1),
    db
      .select()
      .from(partnerImportPolicies)
      .where(eq(partnerImportPolicies.partnerId, partnerId))
      .limit(1),
  ]);
  const source =
    campaignPolicy[0] ?? partnerPolicy[0] ?? defaultDuplicatePolicy;
  return {
    policy: source.policy,
    matchStrategy: source.matchStrategy,
    safeUpdateFields: normalizeSafeUpdateFields(source.safeUpdateFields),
    source: campaignPolicy[0] ? ("campaign" as const) : ("partner" as const),
  };
}

async function getBatchInScope(
  db: V2Database,
  context: PartnerContext,
  batchId: number
) {
  const batch = (
    await db
      .select()
      .from(leadImportBatches)
      .where(
        and(
          eq(leadImportBatches.id, batchId),
          eq(leadImportBatches.partnerId, context.partnerId)
        )
      )
      .limit(1)
  )[0];
  if (!batch) throw new Error("Importação não encontrada");
  const scope = await getCampaignImportScope(
    db,
    context,
    batch.campaignId,
    false
  );
  if (
    context.role === "manager" &&
    batch.importedByMembershipId !== context.membershipId
  ) {
    throw new Error("Importação não encontrada");
  }
  if (
    batch.targetPdvId &&
    scope.accessiblePdvIds &&
    !scope.accessiblePdvIds.includes(batch.targetPdvId)
  ) {
    throw new Error("Importação não encontrada");
  }
  return { batch, scope };
}

function assertPartnerAdmin(context: PartnerContext) {
  if (context.role !== "super_admin" && context.role !== "partner_admin") {
    throw new Error(
      "Apenas Partner Admin pode administrar a configuração de importação"
    );
  }
}

function assertImportOperator(context: PartnerContext) {
  if (context.role === "seller") {
    throw new Error(
      "Vendedores não podem executar importações administrativas"
    );
  }
}

function normalizeOptions(
  fieldType: CustomFieldType,
  options: string[] | null | undefined
) {
  const values = Array.from(
    new Set((options ?? []).map(option => option.trim()).filter(Boolean))
  );
  if (fieldType === "select" && !values.length) {
    throw new Error("Campos do tipo seleção precisam de ao menos uma opção");
  }
  if (fieldType !== "select" && values.length) {
    throw new Error("Apenas campos do tipo seleção podem possuir opções");
  }
  return values.length ? values : null;
}

export async function listCustomFields(
  context: PartnerContext,
  includeInactive = false
) {
  assertImportOperator(context);
  const db = await getV2Db();
  const fields = await listImportCustomFields(db, context.partnerId);
  return includeInactive ? fields : fields.filter(field => field.isActive);
}

export async function saveCustomField(
  context: PartnerContext,
  input: CustomFieldInput
) {
  assertPartnerAdmin(context);
  const db = await getV2Db();
  const key = normalizeFieldKey(input.key);
  const label = input.label.trim();
  if (!label) throw new Error("O nome do campo é obrigatório");
  const optionsJson = normalizeOptions(input.fieldType, input.options);
  const existing = (
    await db
      .select({ fieldType: customFieldDefinitions.fieldType })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.partnerId, context.partnerId),
          eq(customFieldDefinitions.entityType, "lead"),
          eq(customFieldDefinitions.key, key)
        )
      )
      .limit(1)
  )[0];
  if (existing && existing.fieldType !== input.fieldType) {
    throw new Error(
      "O tipo de um campo já utilizado não pode ser alterado. Crie outro campo."
    );
  }
  await db
    .insert(customFieldDefinitions)
    .values({
      partnerId: context.partnerId,
      entityType: "lead",
      key,
      label,
      fieldType: input.fieldType,
      optionsJson,
      isRequired: input.isRequired,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    })
    .onDuplicateKeyUpdate({
      set: {
        label,
        fieldType: input.fieldType,
        optionsJson,
        isRequired: input.isRequired,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
        updatedAt: new Date(),
      },
    });
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "import_custom_field_saved",
    entityType: "custom_field_definition",
    entityId: key,
    metadata: { fieldType: input.fieldType, isActive: input.isActive },
  });
}

async function listTemplateFields(
  db: V2Database,
  partnerId: number,
  templateVersionId: number
) {
  return db
    .select({
      sourceHeader: importTemplateFields.sourceHeader,
      targetKind: importTemplateFields.targetKind,
      targetKey: importTemplateFields.targetKey,
      valueType: importTemplateFields.valueType,
      isRequired: importTemplateFields.isRequired,
      transformKey: importTemplateFields.transformKey,
      sortOrder: importTemplateFields.sortOrder,
    })
    .from(importTemplateFields)
    .where(
      and(
        eq(importTemplateFields.partnerId, partnerId),
        eq(importTemplateFields.templateVersionId, templateVersionId)
      )
    )
    .orderBy(asc(importTemplateFields.sortOrder), asc(importTemplateFields.id));
}

export async function listTemplates(
  context: PartnerContext,
  includeInactive = false
) {
  assertImportOperator(context);
  const db = await getV2Db();
  const templates = await db
    .select()
    .from(importTemplates)
    .where(
      and(
        eq(importTemplates.partnerId, context.partnerId),
        ...(includeInactive ? [] : [eq(importTemplates.isActive, true)])
      )
    )
    .orderBy(asc(importTemplates.name));
  return Promise.all(
    templates.map(async template => {
      const currentVersion = (
        await db
          .select()
          .from(importTemplateVersions)
          .where(
            and(
              eq(importTemplateVersions.partnerId, context.partnerId),
              eq(importTemplateVersions.templateId, template.id)
            )
          )
          .orderBy(desc(importTemplateVersions.versionNumber))
          .limit(1)
      )[0];
      return {
        id: template.id,
        name: template.name,
        isActive: template.isActive,
        currentVersion: currentVersion
          ? {
              id: currentVersion.id,
              versionNumber: currentVersion.versionNumber,
              fields: await listTemplateFields(
                db,
                context.partnerId,
                currentVersion.id
              ),
            }
          : null,
      };
    })
  );
}

export async function setTemplateActive(
  context: PartnerContext,
  templateId: number,
  isActive: boolean
) {
  assertPartnerAdmin(context);
  const db = await getV2Db();
  const result = await db
    .update(importTemplates)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(importTemplates.id, templateId),
        eq(importTemplates.partnerId, context.partnerId)
      )
    );
  if (!asAffectedRows(result)) throw new Error("Template não encontrado");
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: isActive
      ? "import_template_activated"
      : "import_template_deactivated",
    entityType: "import_template",
    entityId: templateId,
  });
}

async function createTemplateVersion(
  db: V2Database,
  context: PartnerContext,
  templateId: number,
  versionNumber: number,
  mappings: ImportMapping[],
  fingerprint: string
) {
  const inserted = await db.insert(importTemplateVersions).values({
    partnerId: context.partnerId,
    templateId,
    versionNumber,
    mappingFingerprint: fingerprint,
    createdByMembershipId: context.membershipId,
  });
  const versionId = asInsertId(inserted);
  if (!versionId)
    throw new Error("Não foi possível criar a versão do template");
  if (mappings.length) {
    await db.insert(importTemplateFields).values(
      mappings.map((mapping, sortOrder) => ({
        partnerId: context.partnerId,
        templateVersionId: versionId,
        sourceHeader: mapping.sourceHeader,
        targetKind: mapping.targetKind,
        targetKey: mapping.targetKey,
        valueType: mapping.valueType,
        isRequired: mapping.isRequired,
        transformKey: mapping.transformKey?.trim() || null,
        sortOrder,
      }))
    );
  }
  return versionId;
}

async function resolveTemplateVersion(
  db: V2Database,
  context: PartnerContext,
  input: {
    templateId?: number | null;
    saveTemplateName?: string | null;
    mappings: ImportMapping[];
  }
) {
  const fingerprint = mappingFingerprint(input.mappings);
  let template = input.templateId
    ? (
        await db
          .select()
          .from(importTemplates)
          .where(
            and(
              eq(importTemplates.id, input.templateId),
              eq(importTemplates.partnerId, context.partnerId),
              eq(importTemplates.isActive, true)
            )
          )
          .limit(1)
      )[0]
    : undefined;

  if (!template && input.saveTemplateName?.trim()) {
    assertPartnerAdmin(context);
    const name = input.saveTemplateName.trim();
    template = (
      await db
        .select()
        .from(importTemplates)
        .where(
          and(
            eq(importTemplates.partnerId, context.partnerId),
            eq(importTemplates.name, name)
          )
        )
        .limit(1)
    )[0];
    if (template && !template.isActive) {
      throw new Error(
        "Reative o template existente antes de criar uma nova versão"
      );
    }
    if (!template) {
      const inserted = await db.insert(importTemplates).values({
        partnerId: context.partnerId,
        name,
        entityType: "lead",
        createdByMembershipId: context.membershipId,
      });
      const templateId = asInsertId(inserted);
      if (!templateId) throw new Error("Não foi possível criar o template");
      const versionId = await createTemplateVersion(
        db,
        context,
        templateId,
        1,
        input.mappings,
        fingerprint
      );
      await writeV2Audit(db, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "import_template_created",
        entityType: "import_template",
        entityId: templateId,
        metadata: { versionNumber: 1 },
      });
      return versionId;
    }
  }
  if (!template) {
    throw new Error(
      "Selecione um template existente ou salve este mapeamento como template"
    );
  }
  const latest = (
    await db
      .select()
      .from(importTemplateVersions)
      .where(
        and(
          eq(importTemplateVersions.partnerId, context.partnerId),
          eq(importTemplateVersions.templateId, template.id)
        )
      )
      .orderBy(desc(importTemplateVersions.versionNumber))
      .limit(1)
  )[0];
  if (latest?.mappingFingerprint === fingerprint) return latest.id;
  assertPartnerAdmin(context);
  const versionId = await createTemplateVersion(
    db,
    context,
    template.id,
    (latest?.versionNumber ?? 0) + 1,
    input.mappings,
    fingerprint
  );
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "import_template_version_created",
    entityType: "import_template",
    entityId: template.id,
    metadata: { versionId, versionNumber: (latest?.versionNumber ?? 0) + 1 },
  });
  return versionId;
}

function assertMappingShape(
  headers: string[],
  mappings: ImportMapping[],
  customFields: ImportCustomField[],
  fixedPdvId: number | null
) {
  if (!mappings.length)
    throw new Error("Mapeie ao menos uma coluna do arquivo");
  const configurationIssues = validateImportMappings(
    headers,
    mappings,
    customFields
  );
  if (
    !mappings.some(
      mapping => mapping.targetKind === "core" && mapping.targetKey === "name"
    )
  ) {
    configurationIssues.push({
      code: "mapping_name_missing",
      fieldKey: "name",
      details: "Mapeie uma coluna para o nome do lead.",
    });
  }
  if (
    !mappings.some(
      mapping =>
        mapping.targetKind === "core" &&
        (mapping.targetKey === "phone" || mapping.targetKey === "email")
    )
  ) {
    configurationIssues.push({
      code: "mapping_contact_missing",
      fieldKey: "phone",
      details: "Mapeie telefone ou e-mail para identificar o lead.",
    });
  }
  if (
    fixedPdvId &&
    mappings.some(
      mapping => mapping.targetKind === "core" && mapping.targetKey === "pdv"
    )
  ) {
    configurationIssues.push({
      code: "mapping_pdv_conflict",
      fieldKey: "pdv",
      details: "Escolha o PDV do arquivo ou uma coluna de PDV, não os dois.",
    });
  }
  if (configurationIssues.length) {
    throw new Error(`Mapeamento inválido: ${configurationIssues[0].details}`);
  }
}

export async function createImportDraft(
  context: PartnerContext,
  input: {
    campaignId: number;
    fileName: string;
    base64: string;
    targetPdvId?: number | null;
  }
) {
  assertImportOperator(context);
  const parsed = parseImportCsv(input.base64);
  const fileName = input.fileName.trim().slice(0, 255);
  if (!fileName) throw new Error("Informe o nome do arquivo CSV");
  if (!fileName.toLocaleLowerCase("pt-BR").endsWith(".csv")) {
    throw new Error("Nesta etapa, somente arquivos CSV são aceitos");
  }
  const db = await getV2Db();
  const scope = await getCampaignImportScope(db, context, input.campaignId);
  const targetPdvId = input.targetPdvId ?? null;
  if (targetPdvId) {
    const pdv = scope.pdvs.find(item => item.id === targetPdvId);
    if (
      !pdv ||
      (scope.accessiblePdvIds && !scope.accessiblePdvIds.includes(pdv.id))
    ) {
      throw new Error(
        "O PDV selecionado não está disponível para esta importação"
      );
    }
  }
  return db.transaction(async tx => {
    const transactionDb = tx as unknown as V2Database;
    const policy = await resolveImportPolicy(
      transactionDb,
      context.partnerId,
      input.campaignId
    );
    const inserted = await tx.insert(leadImportBatches).values({
      partnerId: context.partnerId,
      campaignId: input.campaignId,
      importedByMembershipId: context.membershipId,
      targetPdvId,
      fileName,
      fileSizeBytes: parsed.fileSizeBytes,
      fileChecksum: parsed.fileChecksum,
      delimiter: parsed.delimiter,
      headersJson: parsed.headers,
      duplicatePolicy: policy.policy,
      duplicateMatchStrategy: policy.matchStrategy,
      safeUpdateFields: policy.safeUpdateFields,
      totalRows: parsed.rows.length,
      status: "draft",
    });
    const batchId = asInsertId(inserted);
    if (!batchId) throw new Error("Não foi possível criar a importação");
    for (const rows of chunk(parsed.rows)) {
      await tx.insert(leadImportRows).values(
        rows.map(row => ({
          partnerId: context.partnerId,
          batchId,
          rowNumber: row.rowNumber,
          sourceRowJson: row.values,
          status: "staged" as const,
        }))
      );
    }
    await writeV2Audit(transactionDb, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_import_batch_drafted",
      entityType: "lead_import_batch",
      entityId: batchId,
      metadata: {
        campaignId: input.campaignId,
        fileName,
        totalRows: parsed.rows.length,
      },
    });
    return { batchId, headers: parsed.headers, totalRows: parsed.rows.length };
  });
}

async function findDuplicates(
  db: V2Database,
  partnerId: number,
  rows: Array<{ mapped: MappedStorageRow }>
) {
  const phones = Array.from(
    new Set(
      rows.map(row => row.mapped.normalizedPhone).filter(Boolean) as string[]
    )
  );
  const emails = Array.from(
    new Set(
      rows.map(row => row.mapped.normalizedEmail).filter(Boolean) as string[]
    )
  );
  if (!phones.length && !emails.length) return [];
  const matches = [];
  if (phones.length || emails.length) {
    const clauses = [];
    if (phones.length) clauses.push(inArray(leads.normalizedPhone, phones));
    if (emails.length) clauses.push(inArray(leads.email, emails));
    matches.push(
      ...(await db
        .select({
          id: leads.id,
          normalizedPhone: leads.normalizedPhone,
          email: leads.email,
        })
        .from(leads)
        .where(
          and(
            eq(leads.partnerId, partnerId),
            isNull(leads.deletedAt),
            or(...clauses)!
          )
        ))
    );
  }
  return matches;
}

function selectDuplicate(
  mapped: MappedStorageRow,
  candidates: Array<{
    id: number;
    normalizedPhone: string | null;
    email: string | null;
  }>,
  strategy: DuplicateMatchStrategy
) {
  return candidates.find(candidate =>
    duplicateIsMatch(strategy, mapped, candidate)
  );
}

export async function validateImportBatch(
  context: PartnerContext,
  input: ImportValidationInput
) {
  assertImportOperator(context);
  const db = await getV2Db();
  const { batch, scope } = await getBatchInScope(db, context, input.batchId);
  if (batch.status !== "draft" && batch.status !== "validated") {
    throw new Error("Esta importação não pode mais ser validada");
  }
  await getCampaignImportScope(db, context, batch.campaignId, true);
  const headers = readStringArray(batch.headersJson);
  const customFields = await listImportCustomFields(db, context.partnerId);
  assertMappingShape(headers, input.mappings, customFields, batch.targetPdvId);
  const templateVersionId = await db.transaction(async tx =>
    resolveTemplateVersion(tx as unknown as V2Database, context, input)
  );
  const [activeSources, policy] = await Promise.all([
    db
      .select({
        id: leadSources.id,
        code: leadSources.code,
        label: leadSources.label,
      })
      .from(leadSources)
      .where(
        and(
          eq(leadSources.partnerId, context.partnerId),
          eq(leadSources.isActive, true)
        )
      ),
    resolveImportPolicy(db, context.partnerId, batch.campaignId),
  ]);
  const hasPdvMapping = input.mappings.some(
    mapping => mapping.targetKind === "core" && mapping.targetKey === "pdv"
  );
  if (!batch.targetPdvId && !hasPdvMapping && scope.pdvs.length !== 1) {
    throw new Error(
      "Selecione um PDV para o arquivo ou mapeie uma coluna de PDV"
    );
  }
  const sourceLookup = new Map<string, number>();
  for (const source of activeSources) {
    sourceLookup.set(normalizeReference(source.code), source.id);
    sourceLookup.set(normalizeReference(source.label), source.id);
  }

  await db.transaction(async tx => {
    await tx
      .delete(leadImportIssues)
      .where(
        and(
          eq(leadImportIssues.partnerId, context.partnerId),
          eq(leadImportIssues.batchId, batch.id)
        )
      );
    await tx
      .update(leadImportRows)
      .set({
        mappedDataJson: null,
        targetPdvId: null,
        normalizedPhone: null,
        normalizedEmail: null,
        duplicateLeadId: null,
        status: "staged",
        processedAt: null,
      })
      .where(
        and(
          eq(leadImportRows.partnerId, context.partnerId),
          eq(leadImportRows.batchId, batch.id)
        )
      );
  });

  let lastId = 0;
  let validRows = 0;
  let invalidRows = 0;
  let duplicateRows = 0;
  const seenKeys = new Set<string>();
  while (true) {
    const staged = await db
      .select({
        id: leadImportRows.id,
        rowNumber: leadImportRows.rowNumber,
        sourceRowJson: leadImportRows.sourceRowJson,
      })
      .from(leadImportRows)
      .where(
        and(
          eq(leadImportRows.partnerId, context.partnerId),
          eq(leadImportRows.batchId, batch.id),
          gt(leadImportRows.id, lastId)
        )
      )
      .orderBy(asc(leadImportRows.id))
      .limit(CHUNK_SIZE);
    if (!staged.length) break;
    lastId = staged[staged.length - 1].id;
    const prepared = staged.map(row => {
      const parsed = mapImportRow(
        readTextRecord(row.sourceRowJson),
        input.mappings,
        customFields
      );
      const issues = [...parsed.issues];
      const pdv = resolvePdv(parsed.mapped.pdvValue, scope, batch.targetPdvId);
      if (pdv.issue) issues.push({ ...pdv.issue, fieldKey: "pdv" });
      const sourceId = parsed.mapped.sourceValue
        ? (sourceLookup.get(normalizeReference(parsed.mapped.sourceValue)) ??
          null)
        : null;
      if (parsed.mapped.sourceValue && !sourceId) {
        issues.push({
          code: "source_invalid",
          fieldKey: "source",
          details: "A fonte informada não existe ou está inativa.",
        });
      }
      const mapped: MappedStorageRow = {
        ...parsed.mapped,
        pdvId: pdv.pdvId ?? 0,
        sourceId,
        receivedAt: parsed.mapped.receivedAt?.toISOString() ?? null,
      };
      return { ...row, mapped, issues };
    });
    const candidates = await findDuplicates(
      db,
      context.partnerId,
      prepared.filter(item => !item.issues.length && item.mapped.pdvId)
    );
    const changes = [] as Array<{
      id: number;
      mappedDataJson: MappedStorageRow | null;
      targetPdvId: number | null;
      normalizedPhone: string | null;
      normalizedEmail: string | null;
      duplicateLeadId: number | null;
      status: ImportRowStatus;
      issues: Array<{ code: string; fieldKey: string | null; details: string }>;
    }>;
    for (const item of prepared) {
      const issues = [...item.issues];
      let duplicateLeadId: number | null = null;
      if (!issues.length) {
        const duplicate = selectDuplicate(
          item.mapped,
          candidates,
          policy.matchStrategy
        );
        const internalKey = `${item.mapped.normalizedPhone ?? ""}|${item.mapped.normalizedEmail ?? ""}`;
        const hasIdentity = Boolean(
          item.mapped.normalizedPhone || item.mapped.normalizedEmail
        );
        const inBatchDuplicate = hasIdentity && seenKeys.has(internalKey);
        if (hasIdentity) seenKeys.add(internalKey);
        if (duplicate || inBatchDuplicate) {
          duplicateLeadId = duplicate?.id ?? null;
          issues.push({
            code: inBatchDuplicate
              ? "duplicate_in_batch"
              : "duplicate_possible",
            fieldKey: duplicate ? "phone" : null,
            details: inBatchDuplicate
              ? "A linha repete uma identificação já presente neste arquivo."
              : "Foi encontrada uma possível duplicidade conforme a política atual.",
          });
        }
      }
      const isInvalid = item.issues.length > 0;
      const isDuplicate = !isInvalid && issues.length > 0;
      const status: ImportRowStatus = isInvalid
        ? "invalid"
        : isDuplicate
          ? "duplicate"
          : "valid";
      if (status === "invalid") invalidRows += 1;
      else if (status === "duplicate") duplicateRows += 1;
      else validRows += 1;
      changes.push({
        id: item.id,
        mappedDataJson: isInvalid ? null : item.mapped,
        targetPdvId: isInvalid ? null : item.mapped.pdvId,
        normalizedPhone: isInvalid ? null : item.mapped.normalizedPhone,
        normalizedEmail: isInvalid ? null : item.mapped.normalizedEmail,
        duplicateLeadId,
        status,
        issues,
      });
    }
    await db.transaction(async tx => {
      for (const change of changes) {
        await tx
          .update(leadImportRows)
          .set({
            mappedDataJson: change.mappedDataJson,
            targetPdvId: change.targetPdvId,
            normalizedPhone: change.normalizedPhone,
            normalizedEmail: change.normalizedEmail,
            duplicateLeadId: change.duplicateLeadId,
            status: change.status,
          })
          .where(
            and(
              eq(leadImportRows.id, change.id),
              eq(leadImportRows.partnerId, context.partnerId),
              eq(leadImportRows.batchId, batch.id)
            )
          );
      }
      const issueRows = changes.flatMap(change =>
        change.issues.map(issue => ({
          partnerId: context.partnerId,
          batchId: batch.id,
          rowNumber: staged.find(item => item.id === change.id)!.rowNumber,
          code: issue.code,
          fieldKey: issue.fieldKey,
          details: issue.details,
        }))
      );
      if (issueRows.length) await tx.insert(leadImportIssues).values(issueRows);
    });
  }
  await db.transaction(async tx => {
    await tx
      .update(leadImportBatches)
      .set({
        templateVersionId,
        duplicatePolicy: policy.policy,
        duplicateMatchStrategy: policy.matchStrategy,
        safeUpdateFields: policy.safeUpdateFields,
        validRows,
        invalidRows,
        duplicateRows,
        status: "validated",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leadImportBatches.id, batch.id),
          eq(leadImportBatches.partnerId, context.partnerId)
        )
      );
    await writeV2Audit(tx as unknown as V2Database, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_import_batch_validated",
      entityType: "lead_import_batch",
      entityId: batch.id,
      metadata: { validRows, invalidRows, duplicateRows, templateVersionId },
    });
  });
  return getImportBatch(context, batch.id);
}

async function getNewStatusId(db: V2Database, partnerId: number) {
  const status = (
    await db
      .select({ id: leadStatuses.id })
      .from(leadStatuses)
      .where(
        and(
          eq(leadStatuses.partnerId, partnerId),
          eq(leadStatuses.code, "new"),
          eq(leadStatuses.isActive, true)
        )
      )
      .limit(1)
  )[0];
  if (!status)
    throw new Error("O parceiro não possui um status inicial de lead ativo");
  return status.id;
}

async function insertImportedLead(
  db: V2Database,
  context: PartnerContext,
  batch: DbBatch,
  mapped: MappedStorageRow,
  statusId: number
) {
  const inserted = await db.insert(leads).values({
    partnerId: context.partnerId,
    campaignId: batch.campaignId,
    pdvId: mapped.pdvId,
    statusId,
    sourceId: mapped.sourceId,
    name: mapped.name,
    phone: mapped.phone,
    normalizedPhone: mapped.normalizedPhone,
    email: mapped.email,
    customData: mapped.customData,
    receivedAt: mapped.receivedAt ? new Date(mapped.receivedAt) : new Date(),
    lastActivityAt: new Date(),
  });
  const leadId = asInsertId(inserted);
  if (!leadId) throw new Error("Não foi possível criar o lead importado");
  await db.insert(leadTimelineEvents).values({
    partnerId: context.partnerId,
    leadId,
    actorMembershipId: context.membershipId,
    type: "lead_imported",
    occurredAt: new Date(),
    payloadJson: {
      batchId: batch.id,
      templateVersionId: batch.templateVersionId,
      campaignId: batch.campaignId,
    },
    visibility: "partner",
  });
  return leadId;
}

async function updateLeadSafely(
  db: V2Database,
  context: PartnerContext,
  batch: DbBatch,
  leadId: number,
  mapped: MappedStorageRow
) {
  const existing = (
    await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.partnerId, context.partnerId),
          isNull(leads.deletedAt)
        )
      )
      .limit(1)
  )[0];
  if (!existing) return false;
  const safe = new Set(normalizeSafeUpdateFields(batch.safeUpdateFields));
  const update: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  const changedFields: string[] = [];
  if (safe.has("name") && mapped.name && mapped.name !== existing.name) {
    update.name = mapped.name;
    changedFields.push("name");
  }
  if (safe.has("phone") && mapped.phone && mapped.phone !== existing.phone) {
    update.phone = mapped.phone;
    update.normalizedPhone = mapped.normalizedPhone;
    changedFields.push("phone");
  }
  if (safe.has("email") && mapped.email && mapped.email !== existing.email) {
    update.email = mapped.email;
    changedFields.push("email");
  }
  if (
    safe.has("sourceId") &&
    mapped.sourceId &&
    mapped.sourceId !== existing.sourceId
  ) {
    update.sourceId = mapped.sourceId;
    changedFields.push("sourceId");
  }
  if (safe.has("customData") && Object.keys(mapped.customData).length) {
    update.customData = {
      ...readJsonRecord(existing.customData),
      ...mapped.customData,
    };
    changedFields.push("customData");
  }
  if (!changedFields.length) return false;
  await db
    .update(leads)
    .set(update)
    .where(
      and(eq(leads.id, existing.id), eq(leads.partnerId, context.partnerId))
    );
  await db.insert(leadTimelineEvents).values({
    partnerId: context.partnerId,
    leadId: existing.id,
    actorMembershipId: context.membershipId,
    type: "import_updated",
    occurredAt: new Date(),
    payloadJson: {
      batchId: batch.id,
      templateVersionId: batch.templateVersionId,
      fields: changedFields,
    },
    visibility: "partner",
  });
  return true;
}

async function batchCounts(db: V2Database, partnerId: number, batchId: number) {
  const result = (
    await db
      .select({
        importedRows: sql<number>`coalesce(sum(case when ${leadImportRows.status} = 'imported' then 1 else 0 end), 0)`,
        updatedRows: sql<number>`coalesce(sum(case when ${leadImportRows.status} = 'updated' then 1 else 0 end), 0)`,
        rejectedRows: sql<number>`coalesce(sum(case when ${leadImportRows.status} = 'rejected' then 1 else 0 end), 0)`,
      })
      .from(leadImportRows)
      .where(
        and(
          eq(leadImportRows.partnerId, partnerId),
          eq(leadImportRows.batchId, batchId)
        )
      )
  )[0];
  return {
    importedRows: Number(result?.importedRows ?? 0),
    updatedRows: Number(result?.updatedRows ?? 0),
    rejectedRows: Number(result?.rejectedRows ?? 0),
  };
}

export async function confirmImportBatch(
  context: PartnerContext,
  batchId: number
) {
  assertImportOperator(context);
  const db = await getV2Db();
  const { batch } = await getBatchInScope(db, context, batchId);
  if (batch.status === "completed") return getImportBatch(context, batchId);
  if (batch.status !== "validated") {
    throw new Error("A importação precisa estar validada antes da confirmação");
  }
  await getCampaignImportScope(db, context, batch.campaignId, true);
  const claim = await db
    .update(leadImportBatches)
    .set({
      status: "processing",
      confirmedAt: new Date(),
      startedAt: new Date(),
    })
    .where(
      and(
        eq(leadImportBatches.id, batch.id),
        eq(leadImportBatches.partnerId, context.partnerId),
        eq(leadImportBatches.status, "validated")
      )
    );
  if (!asAffectedRows(claim)) {
    const current = await getBatchInScope(db, context, batchId);
    if (current.batch.status === "completed")
      return getImportBatch(context, batchId);
    throw new Error("Esta importação já está sendo processada");
  }
  try {
    const confirmationScope = await getCampaignImportScope(
      db,
      context,
      batch.campaignId,
      true
    );
    const pendingPdvRows = await db
      .select({ targetPdvId: leadImportRows.targetPdvId })
      .from(leadImportRows)
      .where(
        and(
          eq(leadImportRows.partnerId, context.partnerId),
          eq(leadImportRows.batchId, batch.id),
          inArray(leadImportRows.status, ["valid", "duplicate"])
        )
      );
    const allowedPdvIds = new Set(confirmationScope.pdvs.map(pdv => pdv.id));
    if (
      pendingPdvRows.some(
        row =>
          !row.targetPdvId ||
          !allowedPdvIds.has(row.targetPdvId) ||
          (confirmationScope.accessiblePdvIds &&
            !confirmationScope.accessiblePdvIds.includes(row.targetPdvId))
      )
    ) {
      throw new Error(
        "O escopo de PDVs da campanha mudou desde a validação. Valide o arquivo novamente."
      );
    }
    const newStatusId = await getNewStatusId(db, context.partnerId);
    while (true) {
      // A campaign can be frozen between chunks; stop rather than continuing
      // an operation that has become disallowed.
      await getCampaignImportScope(db, context, batch.campaignId, true);
      const rows = await db
        .select()
        .from(leadImportRows)
        .where(
          and(
            eq(leadImportRows.partnerId, context.partnerId),
            eq(leadImportRows.batchId, batch.id),
            inArray(leadImportRows.status, ["valid", "duplicate"])
          )
        )
        .orderBy(asc(leadImportRows.rowNumber), asc(leadImportRows.id))
        .limit(CHUNK_SIZE);
      if (!rows.length) break;
      await db.transaction(async tx => {
        const transactionDb = tx as unknown as V2Database;
        for (const row of rows) {
          const mapped = parseMappedRow(row.mappedDataJson);
          if (!mapped) {
            await tx
              .update(leadImportRows)
              .set({ status: "rejected", processedAt: new Date() })
              .where(eq(leadImportRows.id, row.id));
            continue;
          }
          if (
            row.status === "duplicate" &&
            batch.duplicatePolicy === "reject"
          ) {
            await tx
              .update(leadImportRows)
              .set({ status: "rejected", processedAt: new Date() })
              .where(eq(leadImportRows.id, row.id));
            continue;
          }
          if (
            row.status === "duplicate" &&
            batch.duplicatePolicy === "update_safe_fields"
          ) {
            const updated = row.duplicateLeadId
              ? await updateLeadSafely(
                  transactionDb,
                  context,
                  batch,
                  row.duplicateLeadId,
                  mapped
                )
              : false;
            await tx
              .update(leadImportRows)
              .set({
                status: updated ? "updated" : "rejected",
                processedAt: new Date(),
              })
              .where(eq(leadImportRows.id, row.id));
            continue;
          }
          await insertImportedLead(
            transactionDb,
            context,
            batch,
            mapped,
            newStatusId
          );
          await tx
            .update(leadImportRows)
            .set({ status: "imported", processedAt: new Date() })
            .where(eq(leadImportRows.id, row.id));
        }
      });
    }
    const counts = await batchCounts(db, context.partnerId, batch.id);
    await db.transaction(async tx => {
      await tx
        .update(leadImportBatches)
        .set({
          ...counts,
          status: "completed",
          completedAt: new Date(),
          errorSummary: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leadImportBatches.id, batch.id),
            eq(leadImportBatches.partnerId, context.partnerId),
            eq(leadImportBatches.status, "processing")
          )
        );
      await writeV2Audit(tx as unknown as V2Database, {
        partnerId: context.partnerId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action: "lead_import_completed",
        entityType: "lead_import_batch",
        entityId: batch.id,
        metadata: counts,
      });
    });
    return getImportBatch(context, batch.id);
  } catch (error) {
    const counts = await batchCounts(db, context.partnerId, batch.id);
    await db
      .update(leadImportBatches)
      .set({
        ...counts,
        status: "failed",
        errorSummary:
          "A importação foi interrompida e requer revisão administrativa.",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(leadImportBatches.id, batch.id),
          eq(leadImportBatches.partnerId, context.partnerId),
          eq(leadImportBatches.status, "processing")
        )
      );
    await writeV2Audit(db, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "lead_import_failed",
      entityType: "lead_import_batch",
      entityId: batch.id,
      metadata: counts,
    });
    throw error;
  }
}

export async function getImportBatch(context: PartnerContext, batchId: number) {
  assertImportOperator(context);
  const db = await getV2Db();
  const { batch } = await getBatchInScope(db, context, batchId);
  return outputBatch(batch);
}

export async function listImportPreviewRows(
  context: PartnerContext,
  input: { batchId: number; page: number; pageSize: number }
) {
  assertImportOperator(context);
  const db = await getV2Db();
  const { batch } = await getBatchInScope(db, context, input.batchId);
  const pageSize = Math.min(Math.max(input.pageSize, 1), PAGE_MAX);
  const where = and(
    eq(leadImportRows.partnerId, context.partnerId),
    eq(leadImportRows.batchId, batch.id)
  );
  const [items, totalRows] = await Promise.all([
    db
      .select({
        rowNumber: leadImportRows.rowNumber,
        status: leadImportRows.status,
        mappedDataJson: leadImportRows.mappedDataJson,
        duplicateLeadId: leadImportRows.duplicateLeadId,
      })
      .from(leadImportRows)
      .where(where)
      .orderBy(asc(leadImportRows.rowNumber), asc(leadImportRows.id))
      .limit(pageSize)
      .offset((Math.max(input.page, 1) - 1) * pageSize),
    db.select({ total: count() }).from(leadImportRows).where(where),
  ]);
  return {
    items: items.map(item => ({
      ...item,
      // Only mapped output (not the raw CSV) is exposed in the preview.
      mappedData: item.mappedDataJson,
    })),
    total: Number(totalRows[0]?.total ?? 0),
    page: Math.max(input.page, 1),
    pageSize,
  };
}

export async function listImportIssues(
  context: PartnerContext,
  input: { batchId: number; page: number; pageSize: number }
) {
  assertImportOperator(context);
  const db = await getV2Db();
  const { batch } = await getBatchInScope(db, context, input.batchId);
  const pageSize = Math.min(Math.max(input.pageSize, 1), PAGE_MAX);
  const where = and(
    eq(leadImportIssues.partnerId, context.partnerId),
    eq(leadImportIssues.batchId, batch.id)
  );
  const [items, totalRows] = await Promise.all([
    db
      .select({
        rowNumber: leadImportIssues.rowNumber,
        code: leadImportIssues.code,
        fieldKey: leadImportIssues.fieldKey,
        details: leadImportIssues.details,
      })
      .from(leadImportIssues)
      .where(where)
      .orderBy(asc(leadImportIssues.rowNumber), asc(leadImportIssues.id))
      .limit(pageSize)
      .offset((Math.max(input.page, 1) - 1) * pageSize),
    db.select({ total: count() }).from(leadImportIssues).where(where),
  ]);
  return {
    items,
    total: Number(totalRows[0]?.total ?? 0),
    page: Math.max(input.page, 1),
    pageSize,
  };
}

export async function listCampaignImportBatches(
  context: PartnerContext,
  input: { campaignId: number; page: number; pageSize: number }
) {
  assertImportOperator(context);
  const db = await getV2Db();
  await getCampaignImportScope(db, context, input.campaignId, false);
  const pageSize = Math.min(Math.max(input.pageSize, 1), PAGE_MAX);
  const where = and(
    eq(leadImportBatches.partnerId, context.partnerId),
    eq(leadImportBatches.campaignId, input.campaignId),
    ...(context.role === "manager"
      ? [eq(leadImportBatches.importedByMembershipId, context.membershipId!)]
      : [])
  );
  const [items, totalRows] = await Promise.all([
    db
      .select({
        batch: leadImportBatches,
        importerName: users.name,
        templateName: importTemplates.name,
        templateVersionNumber: importTemplateVersions.versionNumber,
      })
      .from(leadImportBatches)
      .leftJoin(
        userPartners,
        and(
          eq(userPartners.id, leadImportBatches.importedByMembershipId),
          eq(userPartners.partnerId, leadImportBatches.partnerId)
        )
      )
      .leftJoin(users, eq(users.id, userPartners.userId))
      .leftJoin(
        importTemplateVersions,
        and(
          eq(importTemplateVersions.id, leadImportBatches.templateVersionId),
          eq(importTemplateVersions.partnerId, leadImportBatches.partnerId)
        )
      )
      .leftJoin(
        importTemplates,
        and(
          eq(importTemplates.id, importTemplateVersions.templateId),
          eq(importTemplates.partnerId, leadImportBatches.partnerId)
        )
      )
      .where(where)
      .orderBy(desc(leadImportBatches.createdAt), desc(leadImportBatches.id))
      .limit(pageSize)
      .offset((Math.max(input.page, 1) - 1) * pageSize),
    db.select({ total: count() }).from(leadImportBatches).where(where),
  ]);
  return {
    items: items.map(item => ({
      ...outputBatch(item.batch),
      importerName: item.importerName,
      templateName: item.templateName,
      templateVersionNumber: item.templateVersionNumber,
    })),
    total: Number(totalRows[0]?.total ?? 0),
    page: Math.max(input.page, 1),
    pageSize,
  };
}

export async function getImportSetup(
  context: PartnerContext,
  campaignId: number
) {
  assertImportOperator(context);
  const db = await getV2Db();
  const [scope, customFields, templates, policy] = await Promise.all([
    getCampaignImportScope(db, context, campaignId),
    listImportCustomFields(db, context.partnerId),
    listTemplates(context),
    resolveImportPolicy(db, context.partnerId, campaignId),
  ]);
  return {
    campaign: {
      id: scope.campaign.id,
      name: scope.campaign.name,
      status: scope.campaign.status,
      isFrozen: scope.campaign.isFrozen,
    },
    pdvs: scope.pdvs
      .filter(
        pdv =>
          !scope.accessiblePdvIds || scope.accessiblePdvIds.includes(pdv.id)
      )
      .map(pdv => ({ id: pdv.id, code: pdv.code, name: pdv.name })),
    customFields,
    templates,
    policy,
    canManageTemplates:
      context.role === "super_admin" || context.role === "partner_admin",
  };
}

export async function getPartnerImportPolicy(context: PartnerContext) {
  assertPartnerAdmin(context);
  const db = await getV2Db();
  return resolveImportPolicy(db, context.partnerId, -1);
}

export async function setPartnerImportPolicy(
  context: PartnerContext,
  input: ImportPolicyInput
) {
  assertPartnerAdmin(context);
  const db = await getV2Db();
  const safeUpdateFields = normalizeSafeUpdateFields(input.safeUpdateFields);
  await db
    .insert(partnerImportPolicies)
    .values({
      partnerId: context.partnerId,
      policy: input.policy,
      matchStrategy: input.matchStrategy,
      safeUpdateFields,
    })
    .onDuplicateKeyUpdate({
      set: {
        policy: input.policy,
        matchStrategy: input.matchStrategy,
        safeUpdateFields,
        updatedAt: new Date(),
      },
    });
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "partner_import_policy_updated",
    entityType: "partner_import_policy",
    entityId: context.partnerId,
    metadata: { policy: input.policy, matchStrategy: input.matchStrategy },
  });
}

export async function getCampaignImportPolicy(
  context: PartnerContext,
  campaignId: number
) {
  assertPartnerAdmin(context);
  const db = await getV2Db();
  await getCampaignImportScope(db, context, campaignId, false);
  return resolveImportPolicy(db, context.partnerId, campaignId);
}

export async function setCampaignImportPolicy(
  context: PartnerContext,
  campaignId: number,
  input: ImportPolicyInput | { mode: "inherit" }
) {
  assertPartnerAdmin(context);
  const db = await getV2Db();
  await getCampaignImportScope(db, context, campaignId, false);
  if ("mode" in input) {
    await db
      .delete(campaignImportPolicies)
      .where(
        and(
          eq(campaignImportPolicies.partnerId, context.partnerId),
          eq(campaignImportPolicies.campaignId, campaignId)
        )
      );
    await writeV2Audit(db, {
      partnerId: context.partnerId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: "campaign_import_policy_inherited",
      entityType: "campaign_import_policy",
      entityId: campaignId,
    });
    return;
  }
  const safeUpdateFields = normalizeSafeUpdateFields(input.safeUpdateFields);
  await db
    .insert(campaignImportPolicies)
    .values({
      partnerId: context.partnerId,
      campaignId,
      policy: input.policy,
      matchStrategy: input.matchStrategy,
      safeUpdateFields,
    })
    .onDuplicateKeyUpdate({
      set: {
        policy: input.policy,
        matchStrategy: input.matchStrategy,
        safeUpdateFields,
        updatedAt: new Date(),
      },
    });
  await writeV2Audit(db, {
    partnerId: context.partnerId,
    actorUserId: context.userId,
    actorMembershipId: context.membershipId,
    action: "campaign_import_policy_updated",
    entityType: "campaign_import_policy",
    entityId: campaignId,
    metadata: { policy: input.policy, matchStrategy: input.matchStrategy },
  });
}
