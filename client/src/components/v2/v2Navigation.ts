export type V2NavigationRole =
  | "super_admin"
  | "partner_admin"
  | "manager"
  | "management"
  | "seller";

export type V2NavigationItem = {
  key:
    | "dashboard"
    | "leads"
    | "followUps"
    | "campaigns"
    | "productivity"
    | "reports"
    | "administration"
    | "governance"
    | "importSettings";
  label: string;
  path: string;
  mobilePrimary?: boolean;
  roles: readonly V2NavigationRole[];
};

export const v2RoutePaths = {
  administration: "/v2/admin",
  importSettings: "/v2/import-settings",
  dashboard: "/v2/dashboard",
  productivity: "/v2/productivity",
  reports: "/v2/reports",
  campaignImports: "/v2/campaigns/:id/imports",
  campaignDetail: "/v2/campaigns/:id",
  campaigns: "/v2/campaigns",
  leadDetail: "/v2/leads/:id",
  leads: "/v2/leads",
  followUps: "/v2/follow-ups",
  governance: "/v2/governance",
} as const;

export const v2NavigationItems: readonly V2NavigationItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: v2RoutePaths.dashboard,
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "management", "seller"],
  },
  {
    key: "leads",
    label: "Leads",
    path: v2RoutePaths.leads,
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "management", "seller"],
  },
  {
    key: "followUps",
    label: "Follow-ups",
    path: v2RoutePaths.followUps,
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "management", "seller"],
  },
  {
    key: "campaigns",
    label: "Campanhas",
    path: v2RoutePaths.campaigns,
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "management", "seller"],
  },
  {
    key: "productivity",
    label: "Produtividade",
    path: v2RoutePaths.productivity,
    roles: ["super_admin", "partner_admin", "manager", "management", "seller"],
  },
  {
    key: "reports",
    label: "Relatórios",
    path: v2RoutePaths.reports,
    roles: ["super_admin", "partner_admin", "manager", "management", "seller"],
  },
  {
    key: "administration",
    label: "Administração",
    path: v2RoutePaths.administration,
    roles: ["super_admin", "partner_admin"],
  },
  {
    key: "governance",
    label: "Governança",
    path: v2RoutePaths.governance,
    roles: ["super_admin", "partner_admin"],
  },
  {
    key: "importSettings",
    label: "Importações",
    path: v2RoutePaths.importSettings,
    roles: ["super_admin", "partner_admin"],
  },
];

export function visibleV2Navigation(role: V2NavigationRole | null | undefined) {
  if (!role) return [];
  return v2NavigationItems.filter(item => item.roles.includes(role));
}

export function isV2NavigationActive(path: string, location: string) {
  if (path === v2RoutePaths.administration)
    return location === path || location === "/";
  return location === path || location.startsWith(`${path}/`);
}

export type V2RouteDefinition = {
  path: string;
  roles: readonly V2NavigationRole[];
  matches: (pathname: string) => boolean;
};

function navigationRoute(path: string, roles: readonly V2NavigationRole[]) {
  return { path, roles, matches: (pathname: string) => pathname === path };
}

const campaignRoles = v2NavigationItems.find(
  item => item.key === "campaigns"
)!.roles;
const leadRoles = v2NavigationItems.find(item => item.key === "leads")!.roles;
const administrationRoles = v2NavigationItems.find(
  item => item.key === "administration"
)!.roles;

/**
 * Canonical V2 route catalogue shared by the app router and safe navigation.
 * Numeric identifiers match the application records used by detail routes.
 */
export const v2RouteDefinitions: readonly V2RouteDefinition[] = [
  ...v2NavigationItems.map(item => navigationRoute(item.path, item.roles)),
  {
    path: v2RoutePaths.campaignImports,
    roles: administrationRoles,
    matches: pathname => /^\/v2\/campaigns\/\d+\/imports$/.test(pathname),
  },
  {
    path: v2RoutePaths.campaignDetail,
    roles: campaignRoles,
    matches: pathname => /^\/v2\/campaigns\/\d+$/.test(pathname),
  },
  {
    path: v2RoutePaths.leadDetail,
    roles: leadRoles,
    matches: pathname => /^\/v2\/leads\/\d+$/.test(pathname),
  },
];

export function isAuthorizedV2Route(
  pathname: string,
  role: V2NavigationRole | null | undefined
) {
  if (!role) return false;
  return v2RouteDefinitions.some(
    route => route.roles.includes(role) && route.matches(pathname)
  );
}
