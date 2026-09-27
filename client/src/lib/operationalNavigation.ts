export type OperationalQueryValue =
  | string
  | number
  | boolean
  | null
  | undefined;

function queryValue(value: OperationalQueryValue) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/**
 * Builds an internal V2 link without leaving empty or accidental query values
 * in the URL. Keeping the state in the URL lets browser Back return to the
 * exact operational list that led to a detail page.
 */
export function buildV2Path(
  pathname: string,
  values: Record<string, OperationalQueryValue> = {}
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const normalized = queryValue(value);
    if (normalized !== undefined) params.set(key, normalized);
  }
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function currentV2Path() {
  if (typeof window === "undefined") return "/v2/leads";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * A detail page may receive a `from` query parameter. It must remain an
 * internal V2 location so it cannot turn a normal Back button into an open
 * redirect.
 */
export function safeV2ReturnPath(
  value: string | null | undefined,
  fallback: string
) {
  if (!value) return fallback;
  const candidate = value.trim();
  if (
    !candidate.startsWith("/v2/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://playcell.invalid");
    if (
      parsed.origin !== "https://playcell.invalid" ||
      !parsed.pathname.startsWith("/v2/")
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
