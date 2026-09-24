import { createHash } from "node:crypto";
import type {
  CustomFieldType,
  DuplicateMatchStrategy,
  DuplicatePolicy,
} from "../../drizzle-v2/schema";

export const coreImportKeys = [
  "name",
  "phone",
  "email",
  "source",
  "receivedAt",
  "pdv",
] as const;
export type CoreImportKey = (typeof coreImportKeys)[number];

export type ImportMapping = {
  sourceHeader: string;
  targetKind: "core" | "custom";
  targetKey: string;
  valueType: "text" | "number" | "date" | "boolean";
  isRequired: boolean;
  transformKey?: string | null;
};

export type ImportCustomField = {
  key: string;
  label?: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
  isActive: boolean;
  options: string[] | null;
};

export type ImportIssue = {
  code: string;
  fieldKey: string | null;
  details: string;
};

export type MappedLeadRow = {
  name: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  normalizedEmail: string | null;
  sourceValue: string | null;
  pdvValue: string | null;
  receivedAt: Date | null;
  customData: Record<string, unknown>;
};

const safeUpdateFieldSet = new Set([
  "name",
  "phone",
  "email",
  "sourceId",
  "customData",
]);

export const defaultDuplicatePolicy = {
  policy: "reject" as DuplicatePolicy,
  matchStrategy: "phone_or_email" as DuplicateMatchStrategy,
  safeUpdateFields: ["name", "phone", "email", "sourceId", "customData"],
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || null;
}

export function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return normalized || null;
}

function normalizedComparable(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

export function normalizeImportDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      value
    );
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const parts = iso
    ? {
        year: Number(iso[1]),
        month: Number(iso[2]),
        day: Number(iso[3]),
        hour: Number(iso[4] ?? 0),
        minute: Number(iso[5] ?? 0),
        second: Number(iso[6] ?? 0),
      }
    : brazilian
      ? {
          year: Number(brazilian[3]),
          month: Number(brazilian[2]),
          day: Number(brazilian[1]),
          hour: 12,
          minute: 0,
          second: 0,
        }
      : null;
  if (!parts) return null;
  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
  );
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return date;
}

export function normalizeImportBoolean(raw: string): boolean | null {
  const value = normalizedComparable(raw);
  if (["true", "1", "sim", "s", "yes", "verdadeiro"].includes(value))
    return true;
  if (["false", "0", "não", "nao", "n", "no", "falso"].includes(value))
    return false;
  return null;
}

export function normalizeImportNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function applyTransform(
  value: string,
  transformKey: string | null | undefined
) {
  switch (transformKey) {
    case undefined:
    case null:
    case "":
    case "trim":
      return value.trim();
    case "lowercase":
      return value.trim().toLocaleLowerCase("pt-BR");
    case "uppercase":
      return value.trim().toLocaleUpperCase("pt-BR");
    case "digits_only":
      return value.replace(/\D/g, "");
    default:
      throw new Error("Transformação de importação inválida");
  }
}

function expectedValueType(fieldType: CustomFieldType) {
  if (fieldType === "select") return "text";
  return fieldType;
}

export function validateImportMappings(
  headers: readonly string[],
  mappings: readonly ImportMapping[],
  customFields: readonly ImportCustomField[]
) {
  const headerSet = new Set(headers);
  const mappedHeaders = new Set<string>();
  const destinations = new Set<string>();
  const customByKey = new Map(customFields.map(field => [field.key, field]));
  const issues: ImportIssue[] = [];
  for (const mapping of mappings) {
    const destination = `${mapping.targetKind}:${mapping.targetKey}`;
    if (!headerSet.has(mapping.sourceHeader)) {
      issues.push({
        code: "mapping_header_missing",
        fieldKey: mapping.sourceHeader,
        details: "A coluna mapeada não existe neste arquivo.",
      });
    }
    if (mappedHeaders.has(mapping.sourceHeader)) {
      issues.push({
        code: "mapping_source_duplicate",
        fieldKey: mapping.sourceHeader,
        details: "Uma coluna do arquivo não pode ter mais de um destino.",
      });
    }
    mappedHeaders.add(mapping.sourceHeader);
    if (destinations.has(destination)) {
      issues.push({
        code: "mapping_destination_duplicate",
        fieldKey: mapping.targetKey,
        details: "Um destino não pode receber mais de uma coluna do arquivo.",
      });
    }
    destinations.add(destination);
    try {
      applyTransform("", mapping.transformKey);
    } catch {
      issues.push({
        code: "mapping_transform_invalid",
        fieldKey: mapping.targetKey,
        details: "A transformação informada não é suportada.",
      });
    }
    if (mapping.targetKind === "core") {
      if (!coreImportKeys.includes(mapping.targetKey as CoreImportKey)) {
        issues.push({
          code: "mapping_core_invalid",
          fieldKey: mapping.targetKey,
          details: "O campo interno selecionado não pode ser importado.",
        });
      }
      const expected = mapping.targetKey === "receivedAt" ? "date" : "text";
      if (mapping.valueType !== expected) {
        issues.push({
          code: "mapping_type_invalid",
          fieldKey: mapping.targetKey,
          details: "O tipo do mapeamento não é compatível com o campo interno.",
        });
      }
      continue;
    }
    const custom = customByKey.get(mapping.targetKey);
    if (!custom || !custom.isActive) {
      issues.push({
        code: "mapping_custom_field_invalid",
        fieldKey: mapping.targetKey,
        details: "O campo personalizado não existe ou está inativo.",
      });
    } else if (mapping.valueType !== expectedValueType(custom.fieldType)) {
      issues.push({
        code: "mapping_type_invalid",
        fieldKey: mapping.targetKey,
        details: "O tipo não corresponde ao campo personalizado.",
      });
    }
  }
  for (const field of customFields) {
    if (
      field.isActive &&
      field.isRequired &&
      !destinations.has(`custom:${field.key}`)
    ) {
      issues.push({
        code: "mapping_required_custom_missing",
        fieldKey: field.key,
        details: "Um campo personalizado obrigatório não foi mapeado.",
      });
    }
  }
  return issues;
}

function convertCustomValue(
  rawValue: string,
  field: ImportCustomField
): { value?: unknown; issue?: ImportIssue } {
  const raw = rawValue.trim();
  if (!raw) {
    if (field.isRequired)
      return {
        issue: {
          code: "value_required",
          fieldKey: field.key,
          details: "O campo obrigatório está vazio.",
        },
      };
    return {};
  }
  if (field.fieldType === "text") return { value: raw };
  if (field.fieldType === "number") {
    const value = normalizeImportNumber(raw);
    return value === null
      ? {
          issue: {
            code: "value_number_invalid",
            fieldKey: field.key,
            details: "O valor precisa ser numérico.",
          },
        }
      : { value };
  }
  if (field.fieldType === "date") {
    const value = normalizeImportDate(raw);
    return value === null
      ? {
          issue: {
            code: "value_date_invalid",
            fieldKey: field.key,
            details: "A data não possui um formato válido.",
          },
        }
      : { value: value.toISOString() };
  }
  if (field.fieldType === "boolean") {
    const value = normalizeImportBoolean(raw);
    return value === null
      ? {
          issue: {
            code: "value_boolean_invalid",
            fieldKey: field.key,
            details: "Use um valor booleano reconhecido, como sim ou não.",
          },
        }
      : { value };
  }
  const option = field.options?.find(
    candidate => normalizedComparable(candidate) === normalizedComparable(raw)
  );
  return option === undefined
    ? {
        issue: {
          code: "value_select_invalid",
          fieldKey: field.key,
          details: "O valor não está entre as opções permitidas.",
        },
      }
    : { value: option };
}

export function mapImportRow(
  rawRow: Record<string, string>,
  mappings: readonly ImportMapping[],
  customFields: readonly ImportCustomField[]
): { mapped: MappedLeadRow; issues: ImportIssue[] } {
  const customByKey = new Map(customFields.map(field => [field.key, field]));
  const values: Record<string, string> = {};
  const customData: Record<string, unknown> = {};
  const issues: ImportIssue[] = [];

  for (const mapping of mappings) {
    let raw: string;
    try {
      raw = applyTransform(
        text(rawRow[mapping.sourceHeader]),
        mapping.transformKey
      );
    } catch {
      issues.push({
        code: "mapping_transform_invalid",
        fieldKey: mapping.targetKey,
        details: "A transformação informada não é suportada.",
      });
      continue;
    }
    if (!raw && mapping.isRequired) {
      issues.push({
        code: "value_required",
        fieldKey: mapping.targetKey,
        details: "O campo mapeado como obrigatório está vazio.",
      });
      continue;
    }
    if (mapping.targetKind === "core") {
      values[mapping.targetKey] = raw;
      continue;
    }
    const field = customByKey.get(mapping.targetKey);
    if (!field) continue;
    const converted = convertCustomValue(raw, field);
    if (converted.issue) issues.push(converted.issue);
    else if (converted.value !== undefined)
      customData[field.key] = converted.value;
  }

  const name = values.name?.trim() || null;
  const phone = values.phone?.trim() || null;
  const email = normalizeEmail(values.email);
  if (!name) {
    issues.push({
      code: "lead_name_required",
      fieldKey: "name",
      details: "O nome é obrigatório para criar um lead.",
    });
  }
  if (!normalizePhone(phone) && !email) {
    issues.push({
      code: "lead_contact_required",
      fieldKey: "phone",
      details: "Informe ao menos telefone ou e-mail para o lead.",
    });
  }
  if (phone && (normalizePhone(phone)?.length ?? 0) < 8) {
    issues.push({
      code: "phone_invalid",
      fieldKey: "phone",
      details:
        "O telefone informado não possui quantidade suficiente de dígitos.",
    });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({
      code: "email_invalid",
      fieldKey: "email",
      details: "O e-mail não possui um formato válido.",
    });
  }
  const receivedAt = values.receivedAt
    ? normalizeImportDate(values.receivedAt)
    : null;
  if (values.receivedAt && !receivedAt) {
    issues.push({
      code: "received_at_invalid",
      fieldKey: "receivedAt",
      details: "A data de recebimento não possui um formato válido.",
    });
  }
  return {
    mapped: {
      name,
      phone,
      normalizedPhone: normalizePhone(phone),
      email,
      normalizedEmail: email,
      sourceValue: values.source?.trim() || null,
      pdvValue: values.pdv?.trim() || null,
      receivedAt,
      customData,
    },
    issues,
  };
}

export function mappingFingerprint(mappings: readonly ImportMapping[]) {
  const canonical = [...mappings]
    .map(mapping => ({
      ...mapping,
      transformKey: mapping.transformKey ?? null,
    }))
    .sort((a, b) => a.sourceHeader.localeCompare(b.sourceHeader));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Never allow a policy to update operational or historical lead fields. */
export function normalizeSafeUpdateFields(value: unknown) {
  if (!Array.isArray(value)) return defaultDuplicatePolicy.safeUpdateFields;
  return Array.from(
    new Set(
      value.filter(
        field => typeof field === "string" && safeUpdateFieldSet.has(field)
      )
    )
  );
}

export function duplicateIsMatch(
  strategy: DuplicateMatchStrategy,
  input: { normalizedPhone: string | null; normalizedEmail: string | null },
  candidate: { normalizedPhone: string | null; email: string | null }
) {
  const samePhone =
    Boolean(input.normalizedPhone) &&
    input.normalizedPhone === candidate.normalizedPhone;
  const sameEmail =
    Boolean(input.normalizedEmail) &&
    input.normalizedEmail === normalizeEmail(candidate.email);
  if (strategy === "phone") return samePhone;
  if (strategy === "email") return sameEmail;
  if (strategy === "phone_and_email") return samePhone && sameEmail;
  return samePhone || sameEmail;
}

export function canCreateImportForCampaign(input: {
  status: "draft" | "active" | "closed" | "archived";
  isFrozen: boolean;
}) {
  return (
    !input.isFrozen && (input.status === "draft" || input.status === "active")
  );
}

export function claimImportBatch(status: string) {
  return status === "validated" ? "processing" : status;
}
