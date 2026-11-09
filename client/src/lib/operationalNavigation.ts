import {
  isAuthorizedV2Route,
  type V2NavigationRole,
} from "@/components/v2/v2Navigation";

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
  fallback: string,
  role: V2NavigationRole | null | undefined
) {
  return safeInternalV2Path(value, role) ?? fallback;
}

/** Returns an internal V2 path only when it is safe to navigate to it. */
export function safeInternalV2Path(
  value: string | null | undefined,
  role: V2NavigationRole | null | undefined
) {
  if (!value) return null;
  const candidate = value.trim();
  const rawPathname = candidate.split(/[?#]/, 1)[0];
  if (
    !candidate.startsWith("/v2/") ||
    candidate.startsWith("//") ||
    rawPathname.includes("\\") ||
    rawPathname.includes("//")
  ) {
    return null;
  }

  try {
    const decodedRawPathname = decodeURIComponent(rawPathname);
    const parsed = new URL(candidate, "https://playcell.invalid");
    const decodedPathname = decodeURIComponent(parsed.pathname);
    if (
      parsed.origin !== "https://playcell.invalid" ||
      decodedRawPathname.includes("\\") ||
      decodedRawPathname.split("/").some(segment => segment === "." || segment === "..") ||
      decodedPathname.includes("\\") ||
      decodedPathname.split("/").some(segment => segment === "." || segment === "..") ||
      !isAuthorizedV2Route(parsed.pathname, role)
    ) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/**
 * Identifies a page independently from its local UI state in search/hash.
 * This is used only to prevent Back from resolving to the same page.
 */
export function normalizedV2Pathname(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value, "https://playcell.invalid");
    return parsed.origin === "https://playcell.invalid" ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Chooses a return destination without trusting browser history or external
 * query values. The contextual `from` URL wins so list filters are retained.
 */
export function resolveV2BackPath({
  currentPath,
  from,
  previousPath,
  fallbackPath,
  role,
}: {
  currentPath: string;
  from?: string | null;
  previousPath?: string | null;
  fallbackPath?: string | null;
  role: V2NavigationRole | null | undefined;
}) {
  const currentPathname = normalizedV2Pathname(currentPath);
  for (const candidate of [from, previousPath, fallbackPath]) {
    const safe = safeInternalV2Path(candidate, role);
    if (safe && normalizedV2Pathname(safe) !== currentPathname) return safe;
  }
  return null;
}
