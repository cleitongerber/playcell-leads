import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  // "user" is kept as the legacy value for vendedor so existing OAuth users remain valid.
  role: mysqlEnum("role", ["user", "supervisor", "admin"]).default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/** PDVs are data, never a list embedded in application code. */
export const pdvs = mysqlTable("pdvs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  code: varchar("code", { length: 60 }).notNull(),
  city: varchar("city", { length: 120 }),
  region: varchar("region", { length: 120 }),
  managerUserId: int("managerUserId"),
  isActive: boolean("isActive").default(true).notNull(),
  leadTarget: int("leadTarget"),
  conversionTarget: int("conversionTarget"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeUnique: uniqueIndex("pdvs_code_unique").on(table.code),
  activeIdx: index("pdvs_active_idx").on(table.isActive),
}));

/** A user may have one or more PDVs. seller_profiles stays as a legacy projection. */
export const userPdvs = mysqlTable("user_pdvs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  pdvId: int("pdvId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("user_pdvs_user_idx").on(table.userId),
  pdvIdx: index("user_pdvs_pdv_idx").on(table.pdvId),
  userPdvUnique: uniqueIndex("user_pdvs_user_pdv_unique").on(table.userId, table.pdvId),
}));

/** Campaigns organize imported bases without tying them to a single PDV. */
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").notNull(),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  activeIdx: index("campaigns_active_idx").on(table.isActive),
  createdIdx: index("campaigns_created_idx").on(table.createdAt),
}));

/** A campaign can be made available to multiple PDVs, and a PDV can run many campaigns. */
export const campaignPdvs = mysqlTable("campaign_pdvs", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  pdvId: int("pdvId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  campaignIdx: index("campaign_pdvs_campaign_idx").on(table.campaignId),
  pdvIdx: index("campaign_pdvs_pdv_idx").on(table.pdvId),
  uniqueScope: uniqueIndex("campaign_pdvs_campaign_pdv_unique").on(table.campaignId, table.pdvId),
}));

export const sellerProfiles = mysqlTable("seller_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  store: varchar("store", { length: 80 }).notNull(),
  displayName: varchar("displayName", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  storeIdx: index("seller_profiles_store_idx").on(table.store),
}));

export const leadStatus = [
  "new",
  "assigned",
  "contacted",
  "no_answer",
  "interested",
  "proposal",
  "scheduled",
  "converted",
  "not_interested",
  "invalid",
  "callback",
  "finalized",
] as const;

export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  email: varchar("email", { length: 320 }),
  store: varchar("store", { length: 80 }).notNull(),
  pdvId: int("pdvId"),
  campaignId: int("campaignId"),
  segment: varchar("segment", { length: 120 }),
  priority: mysqlEnum("priority", ["high", "medium", "low"]).default("medium").notNull(),
  source: varchar("source", { length: 120 }).default("Importação manual").notNull(),
  status: mysqlEnum("status", leadStatus).default("new").notNull(),
  assignedTo: int("assignedTo"),
  assignedAt: timestamp("assignedAt"),
  lastContactAt: timestamp("lastContactAt"),
  firstContactAt: timestamp("firstContactAt"),
  nextFollowUpAt: timestamp("nextFollowUpAt"),
  lastContactChannel: mysqlEnum("lastContactChannel", ["whatsapp", "phone", "other"]),
  lastNote: text("lastNote"),
  extraData: text("extraData"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => ({
  statusIdx: index("leads_status_idx").on(table.status),
  storeIdx: index("leads_store_idx").on(table.store),
  assignedIdx: index("leads_assigned_idx").on(table.assignedTo),
  pdvIdx: index("leads_pdv_idx").on(table.pdvId),
  campaignIdx: index("leads_campaign_idx").on(table.campaignId),
  createdIdx: index("leads_created_idx").on(table.createdAt),
  updatedIdx: index("leads_updated_idx").on(table.updatedAt),
  availableIdx: index("leads_available_idx").on(table.pdvId, table.assignedTo, table.status),
}));

export const leadActivities = mysqlTable("lead_activities", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  userId: int("userId").notNull(),
  action: mysqlEnum("action", ["assigned", "contact", "status", "note", "created", "follow_up", "appointment", "conversion", "assignment_changed"]).notNull(),
  channel: mysqlEnum("channel", ["whatsapp", "phone", "other"]),
  status: mysqlEnum("status", leadStatus),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  leadIdx: index("lead_activities_lead_idx").on(table.leadId),
  createdIdx: index("lead_activities_created_idx").on(table.createdAt),
}));

export const leadImports = mysqlTable("lead_imports", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  importedBy: int("importedBy").notNull(),
  rowCount: int("rowCount").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const followUps = mysqlTable("follow_ups", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  createdBy: int("createdBy").notNull(),
  dueAt: timestamp("dueAt").notNull(),
  note: text("note"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  leadDueIdx: index("follow_ups_lead_due_idx").on(table.leadId, table.dueAt),
  dueIdx: index("follow_ups_due_idx").on(table.dueAt),
}));

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 60 }).notNull(),
  entityId: varchar("entityId", { length: 60 }),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  entityIdx: index("audit_entity_idx").on(table.entityType, table.entityId),
  createdIdx: index("audit_created_idx").on(table.createdAt),
  userIdx: index("audit_user_idx").on(table.userId),
}));

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: varchar("type", { length: 60 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body"),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userCreatedIdx: index("notifications_user_created_idx").on(table.userId, table.createdAt) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;
export type LeadStatus = (typeof leadStatus)[number];
export type SellerProfile = typeof sellerProfiles.$inferSelect;
export type Pdv = typeof pdvs.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
