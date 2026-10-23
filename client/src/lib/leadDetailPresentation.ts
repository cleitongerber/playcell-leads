export type LeadCustomFieldDefinition = {
  key: string;
  label: string;
  fieldType: string;
  sortOrder: number;
  isActive: boolean;
};

export type LeadInformationField = {
  key: string;
  label: string;
  value: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function fallbackLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, character => character.toLocaleUpperCase("pt-BR"));
}

function formatCpf(value: string) {
  return /^\d{11}$/.test(value)
    ? value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
    : value;
}

function isCurrencyField(definition: LeadCustomFieldDefinition) {
  const reference = `${definition.key} ${definition.label}`.toLocaleLowerCase(
    "pt-BR"
  );
  return /\b(valor|preço|preco|price|mensalidade|r\$)\b/.test(reference);
}

function formatDate(value: unknown) {
  const dateOnly = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

function formatValue(
  value: unknown,
  definition: LeadCustomFieldDefinition | undefined
) {
  if (definition?.fieldType === "boolean")
    return value === false || value === "false" ? "Não" : "Sim";
  if (definition?.fieldType === "date") return formatDate(value);
  if (definition && isCurrencyField(definition)) {
    const text = String(value).trim();
    const numeric =
      typeof value === "number"
        ? value
        : Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
    if (Number.isFinite(numeric))
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(numeric);
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Produces a stable, read-only view of persisted customData. Definitions are
 * metadata only: an unknown historical key remains visible with a readable
 * fallback label, while inactive fields keep their historic values.
 */
export function presentLeadCustomData(input: {
  normalizedCpf?: string | null;
  customData?: unknown;
  definitions?: LeadCustomFieldDefinition[] | null;
}) {
  const customData = isRecord(input.customData) ? input.customData : {};
  const definitions = [...(input.definitions ?? [])].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.label.localeCompare(right.label, "pt-BR") ||
      left.key.localeCompare(right.key, "pt-BR")
  );
  const definitionByKey = new Map(
    definitions.map(definition => [definition.key, definition])
  );
  const fields: LeadInformationField[] = [];

  if (hasValue(input.normalizedCpf)) {
    fields.push({
      key: "system-cpf",
      label: "CPF",
      value: formatCpf(String(input.normalizedCpf)),
    });
  }

  const hiddenSystemKeys = new Set([
    "name",
    "phone",
    "normalizedPhone",
    "email",
    "normalizedEmail",
    "normalizedCpf",
  ]);
  const alreadyPresented = new Set<string>();
  for (const definition of definitions) {
    const value = customData[definition.key];
    if (
      hiddenSystemKeys.has(definition.key) ||
      (definition.key === "cpf" && hasValue(input.normalizedCpf)) ||
      !hasValue(value)
    ) {
      continue;
    }
    fields.push({
      key: definition.key,
      label:
        definition.key === "cpf" ? "CPF antigo" : definition.label || fallbackLabel(definition.key),
      value: formatValue(value, definition),
    });
    alreadyPresented.add(definition.key);
  }

  Object.keys(customData)
    .filter(key => !hiddenSystemKeys.has(key) && !alreadyPresented.has(key))
    .sort((left, right) => left.localeCompare(right, "pt-BR"))
    .forEach(key => {
      const value = customData[key];
      if (!hasValue(value)) return;
      if (key === "cpf" && hasValue(input.normalizedCpf)) return;
      const definition = definitionByKey.get(key);
      fields.push({
        key,
        label:
          key === "cpf"
            ? "CPF antigo"
            : definition?.label || fallbackLabel(key),
        value: formatValue(value, definition),
      });
    });

  return fields;
}
