import {
  boolean,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const systemRole = ["none", "super_admin"] as const;
export const membershipRole = ["partner_admin", "manager", "seller"] as const;
export const campaignStatus = [
  "draft",
  "active",
  "closed",
  "archived",
] as const;
export const leadStatusCategory = [
  "open",
  "in_progress",
  "completed",
  "discarded",
] as const;
export const leadTimelineType = [
  "lead_created",
  "assigned",
  "assignee_changed",
  "status_changed",
  "contact",
  "note",
  "follow_up_created",
  "follow_up_completed",
  "follow_up_cancelled",
  "follow_up_rescheduled",
  "lead_imported",
  "import_updated",
  "appointment",
  "evidence",
  "lead_distributed",
  "lead_reassigned",
  "lead_returned_to_queue",
  "follow_up_owner_changed",
] as const;
export const timelineVisibility = ["partner", "restricted"] as const;
export const followUpStatus = ["pending", "completed", "cancelled"] as const;
export const governanceRuleMode = ["inherit", "override"] as const;
export const governanceRuleSource = ["partner", "campaign"] as const;
export const evidenceStorageProvider = ["forge_s3", "s3"] as const;
export const evidenceStorageStatus = [
  "uploading",
  "available",
  "failed",
] as const;
export const leadDistributionBatchType = [
  "assign",
  "reassign",
  "return_to_queue",
  "balanced",
] as const;
export const leadDistributionBatchStrategy = ["manual", "balanced"] as const;
export const leadDistributionBatchStatus = ["processing", "completed"] as const;
export const customFieldEntityType = ["lead"] as const;
export const customFieldType = [
  "text",
  "number",
  "date",
  "boolean",
  "select",
] as const;
export const importBatchStatus = [
  "draft",
  "validated",
  "processing",
  "completed",
  "failed",
] as const;
export const importRowStatus = [
  "staged",
  "valid",
  "invalid",
  "duplicate",
  "imported",
  "updated",
  "rejected",
] as const;
export const duplicatePolicy = [
  "reject",
  "allow",
  "update_safe_fields",
] as const;
export const duplicateMatchStrategy = [
  "phone",
  "email",
  "phone_or_email",
  "phone_and_email",
] as const;
export const importFieldTargetKind = ["core", "custom"] as const;
export const importValueType = ["text", "number", "date", "boolean"] as const;

/** Global login identity. Tenant permissions live only in userPartners. */
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 96 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }),
    loginMethod: varchar("loginMethod", { length: 64 })
      .notNull()
      .default("password"),
    systemRole: mysqlEnum("systemRole", systemRole).notNull().default("none"),
    isActive: boolean("isActive").notNull().default(true),
    lastSignedInAt: timestamp("lastSignedInAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    openIdUnique: uniqueIndex("users_open_id_unique").on(table.openId),
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    activeIdx: index("users_active_idx").on(table.isActive),
  })
);

export const partners = mysqlTable(
  "partners",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    codeUnique: uniqueIndex("partners_code_unique").on(table.code),
    activeIdx: index("partners_active_idx").on(table.isActive),
  })
);

export const partnerSettings = mysqlTable(
  "partner_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("America/Sao_Paulo"),
    claimSlaMinutes: int("claimSlaMinutes").notNull().default(5),
    firstContactSlaMinutes: int("firstContactSlaMinutes").notNull().default(15),
    staleLeadMinutes: int("staleLeadMinutes").notNull().default(1440),
    notificationSettings: json("notificationSettings"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerUnique: uniqueIndex("partner_settings_partner_unique").on(
      table.partnerId
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "partner_settings_partner_fk",
    }).onDelete("restrict"),
  })
);

/** Tenant membership and tenant-scoped role. */
export const userPartners = mysqlTable(
  "user_partners",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    partnerId: int("partnerId").notNull(),
    role: mysqlEnum("role", membershipRole).notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    userPartnerUnique: uniqueIndex("user_partners_user_partner_unique").on(
      table.userId,
      table.partnerId
    ),
    idPartnerUnique: uniqueIndex("user_partners_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    partnerRoleActiveIdx: index("user_partners_partner_role_active_idx").on(
      table.partnerId,
      table.role,
      table.isActive
    ),
    userActiveIdx: index("user_partners_user_active_idx").on(
      table.userId,
      table.isActive
    ),
    userReference: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_partners_user_fk",
    }).onDelete("restrict"),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "user_partners_partner_fk",
    }).onDelete("restrict"),
  })
);

/** Operational point of sale. Its code is unique only inside its partner. */
export const pdvs = mysqlTable(
  "pdvs",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    city: varchar("city", { length: 120 }),
    region: varchar("region", { length: 120 }),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerCodeUnique: uniqueIndex("pdvs_partner_code_unique").on(
      table.partnerId,
      table.code
    ),
    idPartnerUnique: uniqueIndex("pdvs_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    partnerActiveIdx: index("pdvs_partner_active_idx").on(
      table.partnerId,
      table.isActive
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "pdvs_partner_fk",
    }).onDelete("restrict"),
  })
);

/**
 * History-preserving operating scope. partnerId is deliberately duplicated so
 * composite foreign keys make a cross-partner assignment impossible in the DB.
 */
export const userPdvAssignments = mysqlTable(
  "user_pdv_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    membershipId: int("membershipId").notNull(),
    pdvId: int("pdvId").notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    membershipPdvUnique: uniqueIndex(
      "user_pdv_assignments_membership_pdv_unique"
    ).on(table.membershipId, table.pdvId),
    membershipActiveIdx: index("user_pdv_assignments_membership_active_idx").on(
      table.membershipId,
      table.isActive
    ),
    pdvActiveIdx: index("user_pdv_assignments_pdv_active_idx").on(
      table.partnerId,
      table.pdvId,
      table.isActive
    ),
    membershipTenantReference: foreignKey({
      columns: [table.membershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "user_pdv_assignments_membership_tenant_fk",
    }).onDelete("restrict"),
    pdvTenantReference: foreignKey({
      columns: [table.pdvId, table.partnerId],
      foreignColumns: [pdvs.id, pdvs.partnerId],
      name: "user_pdv_assignments_pdv_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Campaign lifecycle is separate from the temporary operational freeze. */
export const campaigns = mysqlTable(
  "campaigns",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", campaignStatus).notNull().default("draft"),
    isFrozen: boolean("isFrozen").notNull().default(false),
    startsAt: timestamp("startsAt"),
    endsAt: timestamp("endsAt"),
    archivedAt: timestamp("archivedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerCodeUnique: uniqueIndex("campaigns_partner_code_unique").on(
      table.partnerId,
      table.code
    ),
    idPartnerUnique: uniqueIndex("campaigns_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    partnerStatusIdx: index("campaigns_partner_status_idx").on(
      table.partnerId,
      table.status,
      table.isFrozen
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "campaigns_partner_fk",
    }).onDelete("restrict"),
  })
);

/** Historical campaign-to-PDV scope; removal is a logical deactivation. */
export const campaignPdvs = mysqlTable(
  "campaign_pdvs",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    campaignId: int("campaignId").notNull(),
    pdvId: int("pdvId").notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    campaignPdvUnique: uniqueIndex("campaign_pdvs_campaign_pdv_unique").on(
      table.campaignId,
      table.pdvId
    ),
    campaignActiveIdx: index("campaign_pdvs_campaign_active_idx").on(
      table.partnerId,
      table.campaignId,
      table.isActive
    ),
    pdvActiveIdx: index("campaign_pdvs_pdv_active_idx").on(
      table.partnerId,
      table.pdvId,
      table.isActive
    ),
    campaignTenantReference: foreignKey({
      columns: [table.campaignId, table.partnerId],
      foreignColumns: [campaigns.id, campaigns.partnerId],
      name: "campaign_pdvs_campaign_tenant_fk",
    }).onDelete("restrict"),
    pdvTenantReference: foreignKey({
      columns: [table.pdvId, table.partnerId],
      foreignColumns: [pdvs.id, pdvs.partnerId],
      name: "campaign_pdvs_pdv_tenant_fk",
    }).onDelete("restrict"),
  })
);

export const leadStatuses = mysqlTable(
  "lead_statuses",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    category: mysqlEnum("category", leadStatusCategory).notNull(),
    sortOrder: int("sortOrder").notNull().default(0),
    isTerminal: boolean("isTerminal").notNull().default(false),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerCodeUnique: uniqueIndex("lead_statuses_partner_code_unique").on(
      table.partnerId,
      table.code
    ),
    idPartnerUnique: uniqueIndex("lead_statuses_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    partnerOrderIdx: index("lead_statuses_partner_order_idx").on(
      table.partnerId,
      table.sortOrder,
      table.isActive
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "lead_statuses_partner_fk",
    }).onDelete("restrict"),
  })
);

export const leadSources = mysqlTable(
  "lead_sources",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerCodeUnique: uniqueIndex("lead_sources_partner_code_unique").on(
      table.partnerId,
      table.code
    ),
    idPartnerUnique: uniqueIndex("lead_sources_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    partnerActiveIdx: index("lead_sources_partner_active_idx").on(
      table.partnerId,
      table.isActive
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "lead_sources_partner_fk",
    }).onDelete("restrict"),
  })
);

export const leads = mysqlTable(
  "leads",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    campaignId: int("campaignId").notNull(),
    pdvId: int("pdvId").notNull(),
    statusId: int("statusId").notNull(),
    sourceId: int("sourceId"),
    assignedMembershipId: int("assignedMembershipId"),
    name: varchar("name", { length: 200 }),
    phone: varchar("phone", { length: 64 }),
    normalizedPhone: varchar("normalizedPhone", { length: 32 }),
    email: varchar("email", { length: 320 }),
    customData: json("customData"),
    receivedAt: timestamp("receivedAt").notNull().defaultNow(),
    assignedAt: timestamp("assignedAt"),
    firstContactAt: timestamp("firstContactAt"),
    lastActivityAt: timestamp("lastActivityAt"),
    nextFollowUpAt: timestamp("nextFollowUpAt"),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerCampaignIdx: index("leads_partner_campaign_idx").on(
      table.partnerId,
      table.campaignId,
      table.deletedAt,
      table.createdAt
    ),
    partnerPdvQueueIdx: index("leads_partner_pdv_queue_idx").on(
      table.partnerId,
      table.pdvId,
      table.assignedMembershipId,
      table.deletedAt
    ),
    partnerAssigneeIdx: index("leads_partner_assignee_idx").on(
      table.partnerId,
      table.assignedMembershipId,
      table.deletedAt,
      table.updatedAt
    ),
    partnerDistributionFilterIdx: index(
      "leads_partner_distribution_filter_idx"
    ).on(
      table.partnerId,
      table.campaignId,
      table.pdvId,
      table.statusId,
      table.assignedMembershipId,
      table.deletedAt,
      table.receivedAt,
      table.id
    ),
    partnerCampaignActivityIdx: index("leads_partner_campaign_activity_idx").on(
      table.partnerId,
      table.campaignId,
      table.deletedAt,
      table.lastActivityAt,
      table.id
    ),
    // Period analytics starts with the tenant/date range before applying
    // optional campaign, PDV and current-owner dimensions.
    partnerAnalyticsReceivedIdx: index(
      "leads_partner_analytics_received_idx"
    ).on(
      table.partnerId,
      table.deletedAt,
      table.receivedAt,
      table.campaignId,
      table.pdvId,
      table.assignedMembershipId
    ),
    partnerPhoneIdx: index("leads_partner_normalized_phone_idx").on(
      table.partnerId,
      table.normalizedPhone
    ),
    // TiDB requires an index matching every referenced composite tenant key.
    // `id` remains globally unique, while this index makes the tenant scope
    // explicit and supports child-table foreign keys safely.
    idPartnerUnique: uniqueIndex("leads_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    campaignTenantReference: foreignKey({
      columns: [table.campaignId, table.partnerId],
      foreignColumns: [campaigns.id, campaigns.partnerId],
      name: "leads_campaign_tenant_fk",
    }).onDelete("restrict"),
    pdvTenantReference: foreignKey({
      columns: [table.pdvId, table.partnerId],
      foreignColumns: [pdvs.id, pdvs.partnerId],
      name: "leads_pdv_tenant_fk",
    }).onDelete("restrict"),
    statusTenantReference: foreignKey({
      columns: [table.statusId, table.partnerId],
      foreignColumns: [leadStatuses.id, leadStatuses.partnerId],
      name: "leads_status_tenant_fk",
    }).onDelete("restrict"),
    sourceTenantReference: foreignKey({
      columns: [table.sourceId, table.partnerId],
      foreignColumns: [leadSources.id, leadSources.partnerId],
      name: "leads_source_tenant_fk",
    }).onDelete("restrict"),
    assigneeTenantReference: foreignKey({
      columns: [table.assignedMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "leads_assignee_tenant_fk",
    }).onDelete("restrict"),
  })
);

/**
 * One record per administrative operation. It is both an idempotency boundary
 * for double submits and a concise audit handle for high-volume work.
 */
export const leadDistributionBatches = mysqlTable(
  "lead_distribution_batches",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    campaignId: int("campaignId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    actorMembershipId: int("actorMembershipId"),
    requestKey: varchar("requestKey", { length: 96 }).notNull(),
    type: mysqlEnum("type", leadDistributionBatchType).notNull(),
    strategy: mysqlEnum("strategy", leadDistributionBatchStrategy).notNull(),
    status: mysqlEnum("status", leadDistributionBatchStatus)
      .notNull()
      .default("processing"),
    requestedCount: int("requestedCount").notNull().default(0),
    processedCount: int("processedCount").notNull().default(0),
    successCount: int("successCount").notNull().default(0),
    skippedCount: int("skippedCount").notNull().default(0),
    failedCount: int("failedCount").notNull().default(0),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    partnerActorRequestUnique: uniqueIndex(
      "lead_distribution_batches_partner_actor_request_unique"
    ).on(table.partnerId, table.actorUserId, table.requestKey),
    partnerCampaignCreatedIdx: index(
      "lead_distribution_batches_partner_campaign_created_idx"
    ).on(table.partnerId, table.campaignId, table.createdAt),
    partnerStatusCreatedIdx: index(
      "lead_distribution_batches_partner_status_created_idx"
    ).on(table.partnerId, table.status, table.createdAt),
    partnerCreatedIdx: index(
      "lead_distribution_batches_partner_created_idx"
    ).on(table.partnerId, table.createdAt, table.actorUserId),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "lead_distribution_batches_partner_fk",
    }).onDelete("restrict"),
    campaignTenantReference: foreignKey({
      columns: [table.campaignId, table.partnerId],
      foreignColumns: [campaigns.id, campaigns.partnerId],
      name: "lead_distribution_batches_campaign_tenant_fk",
    }).onDelete("restrict"),
    actorUserReference: foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "lead_distribution_batches_actor_user_fk",
    }).onDelete("restrict"),
    actorMembershipTenantReference: foreignKey({
      columns: [table.actorMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "lead_distribution_batches_actor_membership_tenant_fk",
    }).onDelete("restrict"),
  })
);

export const leadTimelineEvents = mysqlTable(
  "lead_timeline_events",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    leadId: int("leadId").notNull(),
    actorMembershipId: int("actorMembershipId"),
    type: mysqlEnum("type", leadTimelineType).notNull(),
    occurredAt: timestamp("occurredAt").notNull().defaultNow(),
    payloadJson: json("payloadJson"),
    visibility: mysqlEnum("visibility", timelineVisibility)
      .notNull()
      .default("partner"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    leadChronologicalIdx: index(
      "lead_timeline_events_lead_chronological_idx"
    ).on(table.partnerId, table.leadId, table.occurredAt, table.id),
    typeOccurredIdx: index("lead_timeline_events_partner_type_occurred_idx").on(
      table.partnerId,
      table.type,
      table.occurredAt,
      table.actorMembershipId,
      table.leadId
    ),
    idPartnerLeadUnique: uniqueIndex(
      "lead_timeline_events_id_partner_lead_unique"
    ).on(table.id, table.partnerId, table.leadId),
    leadTenantReference: foreignKey({
      columns: [table.leadId, table.partnerId],
      foreignColumns: [leads.id, leads.partnerId],
      name: "lead_timeline_events_lead_tenant_fk",
    }).onDelete("restrict"),
    actorTenantReference: foreignKey({
      columns: [table.actorMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "lead_timeline_events_actor_tenant_fk",
    }).onDelete("restrict"),
  })
);

export const leadContacts = mysqlTable(
  "lead_contacts",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    leadId: int("leadId").notNull(),
    actorMembershipId: int("actorMembershipId").notNull(),
    channel: varchar("channel", { length: 48 }).notNull(),
    outcome: varchar("outcome", { length: 96 }).notNull(),
    summary: text("summary"),
    occurredAt: timestamp("occurredAt").notNull().defaultNow(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    leadOccurredIdx: index("lead_contacts_lead_occurred_idx").on(
      table.partnerId,
      table.leadId,
      table.occurredAt
    ),
    actorOccurredIdx: index("lead_contacts_partner_actor_occurred_idx").on(
      table.partnerId,
      table.actorMembershipId,
      table.occurredAt,
      table.leadId
    ),
    leadTenantReference: foreignKey({
      columns: [table.leadId, table.partnerId],
      foreignColumns: [leads.id, leads.partnerId],
      name: "lead_contacts_lead_tenant_fk",
    }).onDelete("restrict"),
    actorTenantReference: foreignKey({
      columns: [table.actorMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "lead_contacts_actor_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Overdue is intentionally derived from pending + dueAt, never persisted. */
export const followUps = mysqlTable(
  "follow_ups",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    leadId: int("leadId").notNull(),
    ownerMembershipId: int("ownerMembershipId").notNull(),
    rescheduledFromId: int("rescheduledFromId"),
    dueAt: timestamp("dueAt").notNull(),
    status: mysqlEnum("status", followUpStatus).notNull().default("pending"),
    note: text("note"),
    completedAt: timestamp("completedAt"),
    cancelledAt: timestamp("cancelledAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    ownerStatusDueIdx: index("follow_ups_partner_owner_status_due_idx").on(
      table.partnerId,
      table.ownerMembershipId,
      table.status,
      table.dueAt
    ),
    leadStatusDueIdx: index("follow_ups_partner_lead_status_due_idx").on(
      table.partnerId,
      table.leadId,
      table.status,
      table.dueAt
    ),
    statusDueIdx: index("follow_ups_partner_status_due_idx").on(
      table.partnerId,
      table.status,
      table.dueAt
    ),
    ownerCompletedIdx: index("follow_ups_partner_owner_completed_idx").on(
      table.partnerId,
      table.ownerMembershipId,
      table.completedAt,
      table.dueAt
    ),
    leadTenantReference: foreignKey({
      columns: [table.leadId, table.partnerId],
      foreignColumns: [leads.id, leads.partnerId],
      name: "follow_ups_lead_tenant_fk",
    }).onDelete("restrict"),
    ownerTenantReference: foreignKey({
      columns: [table.ownerMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "follow_ups_owner_tenant_fk",
    }).onDelete("restrict"),
    rescheduleReference: foreignKey({
      columns: [table.rescheduledFromId],
      foreignColumns: [table.id],
      name: "follow_ups_rescheduled_from_fk",
    }).onDelete("restrict"),
  })
);

/**
 * Default operational quality rule for a partner. Arrays are nullable so an
 * absent list means unrestricted rather than an accidentally empty allowlist.
 */
export const partnerGovernanceRules = mysqlTable(
  "partner_governance_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    evidenceRequired: boolean("evidenceRequired").notNull().default(false),
    noteRequired: boolean("noteRequired").notNull().default(false),
    followUpRequired: boolean("followUpRequired").notNull().default(false),
    allowedChannels: json("allowedChannels"),
    allowedOutcomes: json("allowedOutcomes"),
    allowedEvidenceMimeTypes: json("allowedEvidenceMimeTypes"),
    maxEvidenceSizeBytes: int("maxEvidenceSizeBytes")
      .notNull()
      .default(5_242_880),
    retentionDays: int("retentionDays"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerUnique: uniqueIndex("partner_governance_rules_partner_unique").on(
      table.partnerId
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "partner_governance_rules_partner_fk",
    }).onDelete("restrict"),
  })
);

/** Campaign overrides are explicit; inherit keeps the partner default intact. */
export const campaignGovernanceOverrides = mysqlTable(
  "campaign_governance_overrides",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    campaignId: int("campaignId").notNull(),
    mode: mysqlEnum("mode", governanceRuleMode).notNull().default("inherit"),
    evidenceRequired: boolean("evidenceRequired").notNull().default(false),
    noteRequired: boolean("noteRequired").notNull().default(false),
    followUpRequired: boolean("followUpRequired").notNull().default(false),
    allowedChannels: json("allowedChannels"),
    allowedOutcomes: json("allowedOutcomes"),
    allowedEvidenceMimeTypes: json("allowedEvidenceMimeTypes"),
    maxEvidenceSizeBytes: int("maxEvidenceSizeBytes")
      .notNull()
      .default(5_242_880),
    retentionDays: int("retentionDays"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    campaignUnique: uniqueIndex(
      "campaign_governance_overrides_campaign_unique"
    ).on(table.campaignId),
    partnerCampaignIdx: index(
      "campaign_governance_overrides_partner_campaign_idx"
    ).on(table.partnerId, table.campaignId, table.mode),
    campaignTenantReference: foreignKey({
      columns: [table.campaignId, table.partnerId],
      foreignColumns: [campaigns.id, campaigns.partnerId],
      name: "campaign_governance_overrides_campaign_tenant_fk",
    }).onDelete("restrict"),
  })
);

/**
 * Immutable timeline events retain the applied policy snapshot separately.
 * A required attachment can therefore remain explicitly pending without
 * mutating the original commercial event.
 */
export const leadTreatmentGovernance = mysqlTable(
  "lead_treatment_governance",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    leadId: int("leadId").notNull(),
    timelineEventId: int("timelineEventId").notNull(),
    ruleSource: mysqlEnum("ruleSource", governanceRuleSource).notNull(),
    appliedRuleJson: json("appliedRuleJson").notNull(),
    noteSatisfied: boolean("noteSatisfied").notNull().default(true),
    followUpSatisfied: boolean("followUpSatisfied").notNull().default(true),
    evidenceSatisfied: boolean("evidenceSatisfied").notNull().default(true),
    isComplete: boolean("isComplete").notNull().default(true),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    eventUnique: uniqueIndex(
      "lead_treatment_governance_partner_event_unique"
    ).on(table.partnerId, table.timelineEventId),
    leadCompletionIdx: index(
      "lead_treatment_governance_lead_completion_idx"
    ).on(table.partnerId, table.leadId, table.isComplete, table.createdAt),
    leadTenantReference: foreignKey({
      columns: [table.leadId, table.partnerId],
      foreignColumns: [leads.id, leads.partnerId],
      name: "lead_treatment_governance_lead_tenant_fk",
    }).onDelete("restrict"),
    timelineLeadTenantReference: foreignKey({
      columns: [table.timelineEventId, table.partnerId, table.leadId],
      foreignColumns: [
        leadTimelineEvents.id,
        leadTimelineEvents.partnerId,
        leadTimelineEvents.leadId,
      ],
      name: "lead_treatment_governance_timeline_lead_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Metadata only: binary content always stays in private object storage. */
export const leadEvidences = mysqlTable(
  "lead_evidences",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    leadId: int("leadId").notNull(),
    timelineEventId: int("timelineEventId").notNull(),
    uploadedByMembershipId: int("uploadedByMembershipId").notNull(),
    storageProvider: mysqlEnum("storageProvider", evidenceStorageProvider)
      .notNull()
      .default("forge_s3"),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    storageStatus: mysqlEnum("storageStatus", evidenceStorageStatus)
      .notNull()
      .default("uploading"),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull(),
    sizeBytes: int("sizeBytes").notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    deletedAt: timestamp("deletedAt"),
  },
  table => ({
    storageKeyUnique: uniqueIndex("lead_evidences_storage_key_unique").on(
      table.storageKey
    ),
    eventActiveIdx: index("lead_evidences_partner_event_active_idx").on(
      table.partnerId,
      table.timelineEventId,
      table.deletedAt,
      table.storageStatus
    ),
    leadCreatedIdx: index("lead_evidences_partner_lead_created_idx").on(
      table.partnerId,
      table.leadId,
      table.deletedAt,
      table.createdAt
    ),
    leadTenantReference: foreignKey({
      columns: [table.leadId, table.partnerId],
      foreignColumns: [leads.id, leads.partnerId],
      name: "lead_evidences_lead_tenant_fk",
    }).onDelete("restrict"),
    timelineLeadTenantReference: foreignKey({
      columns: [table.timelineEventId, table.partnerId, table.leadId],
      foreignColumns: [
        leadTimelineEvents.id,
        leadTimelineEvents.partnerId,
        leadTimelineEvents.leadId,
      ],
      name: "lead_evidences_timeline_lead_tenant_fk",
    }).onDelete("restrict"),
    uploaderTenantReference: foreignKey({
      columns: [table.uploadedByMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "lead_evidences_uploader_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Partner-defined schema for Lead.customData; no dynamic SQL columns. */
export const customFieldDefinitions = mysqlTable(
  "custom_field_definitions",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    entityType: mysqlEnum("entityType", customFieldEntityType)
      .notNull()
      .default("lead"),
    key: varchar("key", { length: 96 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    fieldType: mysqlEnum("fieldType", customFieldType).notNull(),
    optionsJson: json("optionsJson"),
    isRequired: boolean("isRequired").notNull().default(false),
    isActive: boolean("isActive").notNull().default(true),
    sortOrder: int("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerEntityKeyUnique: uniqueIndex(
      "custom_field_definitions_partner_entity_key_unique"
    ).on(table.partnerId, table.entityType, table.key),
    idPartnerUnique: uniqueIndex(
      "custom_field_definitions_id_partner_unique"
    ).on(table.id, table.partnerId),
    partnerActiveOrderIdx: index(
      "custom_field_definitions_partner_active_order_idx"
    ).on(table.partnerId, table.entityType, table.isActive, table.sortOrder),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "custom_field_definitions_partner_fk",
    }).onDelete("restrict"),
  })
);

/** Reusable import identity; mappings live exclusively in immutable versions. */
export const importTemplates = mysqlTable(
  "import_templates",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    entityType: mysqlEnum("entityType", customFieldEntityType)
      .notNull()
      .default("lead"),
    isActive: boolean("isActive").notNull().default(true),
    createdByMembershipId: int("createdByMembershipId"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerNameUnique: uniqueIndex("import_templates_partner_name_unique").on(
      table.partnerId,
      table.name
    ),
    idPartnerUnique: uniqueIndex("import_templates_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    partnerActiveIdx: index("import_templates_partner_active_idx").on(
      table.partnerId,
      table.isActive
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "import_templates_partner_fk",
    }).onDelete("restrict"),
    creatorTenantReference: foreignKey({
      columns: [table.createdByMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "import_templates_creator_tenant_fk",
    }).onDelete("restrict"),
  })
);

export const importTemplateVersions = mysqlTable(
  "import_template_versions",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    templateId: int("templateId").notNull(),
    versionNumber: int("versionNumber").notNull(),
    mappingFingerprint: varchar("mappingFingerprint", {
      length: 128,
    }).notNull(),
    createdByMembershipId: int("createdByMembershipId"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    templateVersionUnique: uniqueIndex(
      "import_template_versions_template_version_unique"
    ).on(table.templateId, table.versionNumber),
    idPartnerUnique: uniqueIndex(
      "import_template_versions_id_partner_unique"
    ).on(table.id, table.partnerId),
    partnerTemplateIdx: index(
      "import_template_versions_partner_template_idx"
    ).on(table.partnerId, table.templateId, table.versionNumber),
    templateTenantReference: foreignKey({
      columns: [table.templateId, table.partnerId],
      foreignColumns: [importTemplates.id, importTemplates.partnerId],
      name: "import_template_versions_template_tenant_fk",
    }).onDelete("restrict"),
    creatorTenantReference: foreignKey({
      columns: [table.createdByMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "import_template_versions_creator_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** A version's fields are never updated after a batch refers to it. */
export const importTemplateFields = mysqlTable(
  "import_template_fields",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    templateVersionId: int("templateVersionId").notNull(),
    sourceHeader: varchar("sourceHeader", { length: 255 }).notNull(),
    targetKind: mysqlEnum("targetKind", importFieldTargetKind).notNull(),
    targetKey: varchar("targetKey", { length: 96 }).notNull(),
    valueType: mysqlEnum("valueType", importValueType)
      .notNull()
      .default("text"),
    isRequired: boolean("isRequired").notNull().default(false),
    transformKey: varchar("transformKey", { length: 96 }),
    sortOrder: int("sortOrder").notNull().default(0),
  },
  table => ({
    versionHeaderUnique: uniqueIndex(
      "import_template_fields_version_header_unique"
    ).on(table.templateVersionId, table.sourceHeader),
    versionOrderIdx: index("import_template_fields_version_order_idx").on(
      table.partnerId,
      table.templateVersionId,
      table.sortOrder
    ),
    versionTenantReference: foreignKey({
      columns: [table.templateVersionId, table.partnerId],
      foreignColumns: [
        importTemplateVersions.id,
        importTemplateVersions.partnerId,
      ],
      name: "import_template_fields_version_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Default duplicate policy. Campaigns may override it without mutating history. */
export const partnerImportPolicies = mysqlTable(
  "partner_import_policies",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    policy: mysqlEnum("policy", duplicatePolicy).notNull().default("reject"),
    matchStrategy: mysqlEnum("matchStrategy", duplicateMatchStrategy)
      .notNull()
      .default("phone_or_email"),
    safeUpdateFields: json("safeUpdateFields"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerUnique: uniqueIndex("partner_import_policies_partner_unique").on(
      table.partnerId
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "partner_import_policies_partner_fk",
    }).onDelete("restrict"),
  })
);

export const campaignImportPolicies = mysqlTable(
  "campaign_import_policies",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    campaignId: int("campaignId").notNull(),
    policy: mysqlEnum("policy", duplicatePolicy).notNull().default("reject"),
    matchStrategy: mysqlEnum("matchStrategy", duplicateMatchStrategy)
      .notNull()
      .default("phone_or_email"),
    safeUpdateFields: json("safeUpdateFields"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    campaignUnique: uniqueIndex("campaign_import_policies_campaign_unique").on(
      table.campaignId
    ),
    partnerCampaignIdx: index(
      "campaign_import_policies_partner_campaign_idx"
    ).on(table.partnerId, table.campaignId),
    campaignTenantReference: foreignKey({
      columns: [table.campaignId, table.partnerId],
      foreignColumns: [campaigns.id, campaigns.partnerId],
      name: "campaign_import_policies_campaign_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** A batch has no raw file blob; bounded parsed source rows are staged below. */
export const leadImportBatches = mysqlTable(
  "lead_import_batches",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    campaignId: int("campaignId").notNull(),
    templateVersionId: int("templateVersionId"),
    // Super Admin operates within a PartnerContext but has no tenant membership.
    importedByMembershipId: int("importedByMembershipId"),
    targetPdvId: int("targetPdvId"),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    fileSizeBytes: int("fileSizeBytes").notNull(),
    fileChecksum: varchar("fileChecksum", { length: 128 }).notNull(),
    delimiter: varchar("delimiter", { length: 1 }).notNull(),
    headersJson: json("headersJson").notNull(),
    duplicatePolicy: mysqlEnum("duplicatePolicy", duplicatePolicy)
      .notNull()
      .default("reject"),
    duplicateMatchStrategy: mysqlEnum(
      "duplicateMatchStrategy",
      duplicateMatchStrategy
    )
      .notNull()
      .default("phone_or_email"),
    safeUpdateFields: json("safeUpdateFields"),
    totalRows: int("totalRows").notNull().default(0),
    validRows: int("validRows").notNull().default(0),
    invalidRows: int("invalidRows").notNull().default(0),
    importedRows: int("importedRows").notNull().default(0),
    duplicateRows: int("duplicateRows").notNull().default(0),
    rejectedRows: int("rejectedRows").notNull().default(0),
    updatedRows: int("updatedRows").notNull().default(0),
    status: mysqlEnum("status", importBatchStatus).notNull().default("draft"),
    errorSummary: varchar("errorSummary", { length: 1000 }),
    confirmedAt: timestamp("confirmedAt"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    partnerCampaignCreatedIdx: index(
      "lead_import_batches_partner_campaign_created_idx"
    ).on(table.partnerId, table.campaignId, table.createdAt),
    partnerStatusIdx: index("lead_import_batches_partner_status_idx").on(
      table.partnerId,
      table.status,
      table.createdAt
    ),
    idPartnerUnique: uniqueIndex("lead_import_batches_id_partner_unique").on(
      table.id,
      table.partnerId
    ),
    campaignTenantReference: foreignKey({
      columns: [table.campaignId, table.partnerId],
      foreignColumns: [campaigns.id, campaigns.partnerId],
      name: "lead_import_batches_campaign_tenant_fk",
    }).onDelete("restrict"),
    templateVersionTenantReference: foreignKey({
      columns: [table.templateVersionId, table.partnerId],
      foreignColumns: [
        importTemplateVersions.id,
        importTemplateVersions.partnerId,
      ],
      name: "lead_import_batches_template_version_tenant_fk",
    }).onDelete("restrict"),
    importerTenantReference: foreignKey({
      columns: [table.importedByMembershipId, table.partnerId],
      foreignColumns: [userPartners.id, userPartners.partnerId],
      name: "lead_import_batches_importer_tenant_fk",
    }).onDelete("restrict"),
    targetPdvTenantReference: foreignKey({
      columns: [table.targetPdvId, table.partnerId],
      foreignColumns: [pdvs.id, pdvs.partnerId],
      name: "lead_import_batches_target_pdv_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Bounded staging data makes preview/retry possible without storing the CSV blob. */
export const leadImportRows = mysqlTable(
  "lead_import_rows",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    batchId: int("batchId").notNull(),
    rowNumber: int("rowNumber").notNull(),
    sourceRowJson: json("sourceRowJson").notNull(),
    mappedDataJson: json("mappedDataJson"),
    targetPdvId: int("targetPdvId"),
    normalizedPhone: varchar("normalizedPhone", { length: 32 }),
    normalizedEmail: varchar("normalizedEmail", { length: 320 }),
    duplicateLeadId: int("duplicateLeadId"),
    status: mysqlEnum("status", importRowStatus).notNull().default("staged"),
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    batchRowUnique: uniqueIndex("lead_import_rows_batch_row_unique").on(
      table.batchId,
      table.rowNumber
    ),
    batchStatusRowIdx: index("lead_import_rows_batch_status_row_idx").on(
      table.partnerId,
      table.batchId,
      table.status,
      table.rowNumber
    ),
    duplicateIdx: index("lead_import_rows_partner_duplicate_idx").on(
      table.partnerId,
      table.duplicateLeadId
    ),
    batchTenantReference: foreignKey({
      columns: [table.batchId, table.partnerId],
      foreignColumns: [leadImportBatches.id, leadImportBatches.partnerId],
      name: "lead_import_rows_batch_tenant_fk",
    }).onDelete("restrict"),
    targetPdvTenantReference: foreignKey({
      columns: [table.targetPdvId, table.partnerId],
      foreignColumns: [pdvs.id, pdvs.partnerId],
      name: "lead_import_rows_target_pdv_tenant_fk",
    }).onDelete("restrict"),
    duplicateLeadTenantReference: foreignKey({
      columns: [table.duplicateLeadId, table.partnerId],
      foreignColumns: [leads.id, leads.partnerId],
      name: "lead_import_rows_duplicate_lead_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Safe error metadata for users; source values are never copied into issues. */
export const leadImportIssues = mysqlTable(
  "lead_import_issues",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").notNull(),
    batchId: int("batchId").notNull(),
    rowNumber: int("rowNumber").notNull(),
    code: varchar("code", { length: 96 }).notNull(),
    fieldKey: varchar("fieldKey", { length: 96 }),
    details: varchar("details", { length: 1000 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    batchRowIdx: index("lead_import_issues_batch_row_idx").on(
      table.partnerId,
      table.batchId,
      table.rowNumber,
      table.id
    ),
    batchTenantReference: foreignKey({
      columns: [table.batchId, table.partnerId],
      foreignColumns: [leadImportBatches.id, leadImportBatches.partnerId],
      name: "lead_import_issues_batch_tenant_fk",
    }).onDelete("restrict"),
  })
);

/** Immutable audit trail. partnerId is null only for global super-admin actions. */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId"),
    actorUserId: int("actorUserId"),
    actorMembershipId: int("actorMembershipId"),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 96 }),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    partnerEntityCreatedIdx: index("audit_logs_partner_entity_created_idx").on(
      table.partnerId,
      table.entityType,
      table.entityId,
      table.createdAt
    ),
    actorCreatedIdx: index("audit_logs_actor_created_idx").on(
      table.actorUserId,
      table.createdAt
    ),
    partnerReference: foreignKey({
      columns: [table.partnerId],
      foreignColumns: [partners.id],
      name: "audit_logs_partner_fk",
    }).onDelete("restrict"),
    actorUserReference: foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "audit_logs_actor_user_fk",
    }).onDelete("restrict"),
    actorMembershipReference: foreignKey({
      columns: [table.actorMembershipId],
      foreignColumns: [userPartners.id],
      name: "audit_logs_actor_membership_fk",
    }).onDelete("restrict"),
  })
);

export type V2User = typeof users.$inferSelect;
export type V2Partner = typeof partners.$inferSelect;
export type V2UserPartner = typeof userPartners.$inferSelect;
export type V2Pdv = typeof pdvs.$inferSelect;
export type V2UserPdvAssignment = typeof userPdvAssignments.$inferSelect;
export type V2Campaign = typeof campaigns.$inferSelect;
export type CampaignStatus = (typeof campaignStatus)[number];
export type LeadStatusCategory = (typeof leadStatusCategory)[number];
export type LeadTimelineType = (typeof leadTimelineType)[number];
export type LeadDistributionBatchType =
  (typeof leadDistributionBatchType)[number];
export type FollowUpStatus = (typeof followUpStatus)[number];
export type GovernanceRuleMode = (typeof governanceRuleMode)[number];
export type GovernanceRuleSource = (typeof governanceRuleSource)[number];
export type EvidenceStorageStatus = (typeof evidenceStorageStatus)[number];
export type CustomFieldType = (typeof customFieldType)[number];
export type ImportBatchStatus = (typeof importBatchStatus)[number];
export type ImportRowStatus = (typeof importRowStatus)[number];
export type DuplicatePolicy = (typeof duplicatePolicy)[number];
export type DuplicateMatchStrategy = (typeof duplicateMatchStrategy)[number];
export type MembershipRole = (typeof membershipRole)[number];
export type SystemRole = (typeof systemRole)[number];
