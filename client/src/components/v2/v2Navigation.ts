export type V2NavigationRole =
  | "super_admin"
  | "partner_admin"
  | "manager"
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

export const v2NavigationItems: readonly V2NavigationItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/v2/dashboard",
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "seller"],
  },
  {
    key: "leads",
    label: "Leads",
    path: "/v2/leads",
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "seller"],
  },
  {
    key: "followUps",
    label: "Follow-ups",
    path: "/v2/follow-ups",
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "seller"],
  },
  {
    key: "campaigns",
    label: "Campanhas",
    path: "/v2/campaigns",
    mobilePrimary: true,
    roles: ["super_admin", "partner_admin", "manager", "seller"],
  },
  {
    key: "productivity",
    label: "Produtividade",
    path: "/v2/productivity",
    roles: ["super_admin", "partner_admin", "manager", "seller"],
  },
  {
    key: "reports",
    label: "Relatórios",
    path: "/v2/reports",
    roles: ["super_admin", "partner_admin", "manager", "seller"],
  },
  {
    key: "administration",
    label: "Administração",
    path: "/v2/admin",
    roles: ["super_admin", "partner_admin"],
  },
  {
    key: "governance",
    label: "Governança",
    path: "/v2/governance",
    roles: ["super_admin", "partner_admin"],
  },
  {
    key: "importSettings",
    label: "Importações",
    path: "/v2/import-settings",
    roles: ["super_admin", "partner_admin"],
  },
];

export function visibleV2Navigation(role: V2NavigationRole | null | undefined) {
  if (!role) return [];
  return v2NavigationItems.filter(item => item.roles.includes(role));
}

export function isV2NavigationActive(path: string, location: string) {
  if (path === "/v2/admin") return location === path || location === "/";
  return location === path || location.startsWith(`${path}/`);
}
