/**
 * Safe, text-only helpers shared by the V2 client and server. They never
 * perform a network request or persist a contact: opening WhatsApp or a
 * dialer is deliberately kept separate from recording a treatment.
 */

export const DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE =
  "Olá, {{primeiro_nome}}! Tudo bem? Meu nome é {{vendedor}} e estou entrando em contato para dar continuidade ao seu atendimento.";

export const WHATSAPP_TEMPLATE_VARIABLES = [
  { key: "nome", placeholder: "{{nome}}", label: "Nome completo" },
  {
    key: "primeiro_nome",
    placeholder: "{{primeiro_nome}}",
    label: "Primeiro nome",
  },
  { key: "vendedor", placeholder: "{{vendedor}}", label: "Vendedor" },
  { key: "pdv", placeholder: "{{pdv}}", label: "PDV" },
  { key: "campanha", placeholder: "{{campanha}}", label: "Campanha" },
] as const;

export type WhatsAppTemplateVariable =
  (typeof WHATSAPP_TEMPLATE_VARIABLES)[number]["key"];

export type WhatsAppTemplateValues = Partial<
  Record<WhatsAppTemplateVariable, string | null | undefined>
>;

const allowedVariables = new Set<WhatsAppTemplateVariable>(
  WHATSAPP_TEMPLATE_VARIABLES.map(variable => variable.key)
);

const placeholderPattern = /{{\s*([^{}]+?)\s*}}/g;

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/, 1)[0] ?? "";
}

function normalizeRenderedMessage(value: string) {
  return (
    value
      .replace(/[\t ]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      // A missing name in "Olá, {{primeiro_nome}}!" should become "Olá!",
      // never "Olá,!" or a raw placeholder.
      .replace(/,\s*([.!?])/g, "$1")
      .replace(/\(\s*\)/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/**
 * Renders only the documented placeholder allowlist. Unknown or malformed
 * placeholders are removed rather than being exposed to a customer.
 */
export function renderWhatsAppInitialMessage(
  template: string | null | undefined,
  values: WhatsAppTemplateValues
) {
  const safeTemplate =
    template?.trim() || DEFAULT_WHATSAPP_INITIAL_MESSAGE_TEMPLATE;
  const normalizedValues: Record<WhatsAppTemplateVariable, string> = {
    nome: values.nome?.trim() || "",
    primeiro_nome: values.primeiro_nome?.trim() || firstName(values.nome),
    vendedor: values.vendedor?.trim() || "",
    pdv: values.pdv?.trim() || "",
    campanha: values.campanha?.trim() || "",
  };

  return normalizeRenderedMessage(
    safeTemplate.replace(
      placeholderPattern,
      (_placeholder, rawName: string) => {
        const key = rawName.trim().toLowerCase() as WhatsAppTemplateVariable;
        return allowedVariables.has(key) ? normalizedValues[key] : "";
      }
    )
  );
}

/** Returns only allowed variables present in a template, useful for redacted audit metadata. */
export function referencedWhatsAppTemplateVariables(template: string) {
  const result = new Set<WhatsAppTemplateVariable>();
  for (const match of Array.from(template.matchAll(placeholderPattern))) {
    const key = match[1].trim().toLowerCase() as WhatsAppTemplateVariable;
    if (allowedVariables.has(key)) result.add(key);
  }
  return Array.from(result).sort();
}

function isBrazilianNationalNumber(value: string) {
  if (value.length !== 10 && value.length !== 11) return false;
  const ddd = Number(value.slice(0, 2));
  if (!Number.isInteger(ddd) || ddd < 11 || ddd > 99) return false;
  const subscriber = value.slice(2);
  return /^[2-9]\d+$/.test(subscriber);
}

function isPlausibleInternationalNumber(value: string) {
  return value.length >= 8 && value.length <= 15 && !/^(\d)\1+$/.test(value);
}

/**
 * Produces an E.164-like digit sequence without changing explicit
 * international input. Unprefixed 10/11-digit numbers are interpreted as
 * Brazilian national numbers and receive country code 55.
 */
export function normalizePhoneForDirectContact(
  phone: string | null | undefined
) {
  const source = phone?.trim() ?? "";
  const digits = source.replace(/\D/g, "");
  if (!digits) return null;

  if (source.startsWith("+")) {
    return isPlausibleInternationalNumber(digits) ? digits : null;
  }

  if (source.startsWith("00")) {
    const international = digits.slice(2);
    return isPlausibleInternationalNumber(international) ? international : null;
  }

  if (isBrazilianNationalNumber(digits)) return `55${digits}`;

  if (digits.startsWith("55") && isBrazilianNationalNumber(digits.slice(2))) {
    return digits;
  }

  return null;
}

export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string
) {
  const normalizedPhone = normalizePhoneForDirectContact(phone);
  if (!normalizedPhone || !message.trim()) return null;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

export function buildTelephoneUrl(phone: string | null | undefined) {
  const normalizedPhone = normalizePhoneForDirectContact(phone);
  return normalizedPhone ? `tel:+${normalizedPhone}` : null;
}
