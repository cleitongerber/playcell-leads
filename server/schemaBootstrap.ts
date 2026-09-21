/**
 * First-run schema for an independent Render/TiDB deployment.
 *
 * Every statement is additive (`IF NOT EXISTS`), so it never removes or
 * modifies existing records. Subsequent structural changes remain explicit
 * Drizzle migrations in `drizzle/`.
 */
export const initialSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`openId\` varchar(64) NOT NULL,
    \`name\` text,
    \`email\` varchar(320),
    \`loginMethod\` varchar(64),
    \`passwordHash\` varchar(255),
    \`role\` enum('user','supervisor','admin') NOT NULL DEFAULT 'user',
    \`isActive\` boolean NOT NULL DEFAULT true,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    \`lastSignedIn\` timestamp NOT NULL DEFAULT (now()),
    PRIMARY KEY (\`id\`), UNIQUE KEY \`users_open_id_unique\` (\`openId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`pdvs\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`name\` varchar(120) NOT NULL, \`code\` varchar(60) NOT NULL,
    \`city\` varchar(120), \`region\` varchar(120), \`managerUserId\` int,
    \`isActive\` boolean NOT NULL DEFAULT true, \`leadTarget\` int, \`conversionTarget\` int,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`), UNIQUE KEY \`pdvs_code_unique\` (\`code\`), KEY \`pdvs_active_idx\` (\`isActive\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`user_pdvs\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`userId\` int NOT NULL, \`pdvId\` int NOT NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()), PRIMARY KEY (\`id\`),
    UNIQUE KEY \`user_pdvs_user_pdv_unique\` (\`userId\`, \`pdvId\`),
    KEY \`user_pdvs_user_idx\` (\`userId\`), KEY \`user_pdvs_pdv_idx\` (\`pdvId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`campaigns\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`name\` varchar(160) NOT NULL, \`description\` text,
    \`isActive\` boolean NOT NULL DEFAULT true, \`createdBy\` int NOT NULL, \`deletedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()), \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`), KEY \`campaigns_active_idx\` (\`isActive\`), KEY \`campaigns_created_idx\` (\`createdAt\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`campaign_pdvs\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`campaignId\` int NOT NULL, \`pdvId\` int NOT NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()), PRIMARY KEY (\`id\`),
    UNIQUE KEY \`campaign_pdvs_campaign_pdv_unique\` (\`campaignId\`, \`pdvId\`),
    KEY \`campaign_pdvs_campaign_idx\` (\`campaignId\`), KEY \`campaign_pdvs_pdv_idx\` (\`pdvId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`seller_profiles\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`userId\` int NOT NULL, \`store\` varchar(80) NOT NULL,
    \`displayName\` varchar(160) NOT NULL, \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`), UNIQUE KEY \`seller_profiles_userId_unique\` (\`userId\`), KEY \`seller_profiles_store_idx\` (\`store\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`leads\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`name\` varchar(160) NOT NULL, \`phone\` varchar(40) NOT NULL,
    \`email\` varchar(320), \`store\` varchar(80) NOT NULL, \`pdvId\` int, \`campaignId\` int, \`segment\` varchar(120),
    \`priority\` enum('high','medium','low') NOT NULL DEFAULT 'medium',
    \`source\` varchar(120) NOT NULL DEFAULT 'Importação manual',
    \`status\` enum('new','assigned','contacted','no_answer','interested','proposal','scheduled','converted','not_interested','invalid','callback','finalized') NOT NULL DEFAULT 'new',
    \`assignedTo\` int, \`assignedAt\` timestamp NULL, \`lastContactAt\` timestamp NULL,
    \`firstContactAt\` timestamp NULL, \`nextFollowUpAt\` timestamp NULL,
    \`lastContactChannel\` enum('whatsapp','phone','other'), \`lastNote\` text, \`extraData\` text,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()), \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    \`deletedAt\` timestamp NULL, PRIMARY KEY (\`id\`),
    KEY \`leads_status_idx\` (\`status\`), KEY \`leads_store_idx\` (\`store\`), KEY \`leads_assigned_idx\` (\`assignedTo\`),
    KEY \`leads_pdv_idx\` (\`pdvId\`), KEY \`leads_campaign_idx\` (\`campaignId\`), KEY \`leads_created_idx\` (\`createdAt\`), KEY \`leads_updated_idx\` (\`updatedAt\`),
    KEY \`leads_available_idx\` (\`pdvId\`, \`assignedTo\`, \`status\`)
  )`,
  // These two statements are harmlessly ignored on later boots once the additive change exists.
  `ALTER TABLE \`leads\` ADD COLUMN \`campaignId\` int NULL`,
  `CREATE INDEX \`leads_campaign_idx\` ON \`leads\` (\`campaignId\`)`,
  `CREATE TABLE IF NOT EXISTS \`lead_activities\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`leadId\` int NOT NULL, \`userId\` int NOT NULL,
    \`action\` enum('assigned','contact','status','note','created','follow_up','appointment','conversion','assignment_changed') NOT NULL,
    \`channel\` enum('whatsapp','phone','other'),
    \`status\` enum('new','assigned','contacted','no_answer','interested','proposal','scheduled','converted','not_interested','invalid','callback','finalized'),
    \`note\` text, \`createdAt\` timestamp NOT NULL DEFAULT (now()), PRIMARY KEY (\`id\`),
    KEY \`lead_activities_lead_idx\` (\`leadId\`), KEY \`lead_activities_created_idx\` (\`createdAt\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`lead_imports\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`fileName\` varchar(255) NOT NULL, \`importedBy\` int NOT NULL,
    \`rowCount\` int NOT NULL, \`createdAt\` timestamp NOT NULL DEFAULT (now()), PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`follow_ups\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`leadId\` int NOT NULL, \`createdBy\` int NOT NULL,
    \`dueAt\` timestamp NOT NULL, \`note\` text, \`completedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()), PRIMARY KEY (\`id\`),
    KEY \`follow_ups_lead_due_idx\` (\`leadId\`, \`dueAt\`), KEY \`follow_ups_due_idx\` (\`dueAt\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`audit_logs\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`userId\` int, \`action\` varchar(100) NOT NULL,
    \`entityType\` varchar(60) NOT NULL, \`entityId\` varchar(60), \`details\` text,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()), PRIMARY KEY (\`id\`),
    KEY \`audit_entity_idx\` (\`entityType\`, \`entityId\`), KEY \`audit_created_idx\` (\`createdAt\`), KEY \`audit_user_idx\` (\`userId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`notifications\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`userId\` int NOT NULL, \`type\` varchar(60) NOT NULL,
    \`title\` varchar(180) NOT NULL, \`body\` text, \`readAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT (now()), PRIMARY KEY (\`id\`),
    KEY \`notifications_user_created_idx\` (\`userId\`, \`createdAt\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`password_reset_requests\` (
    \`id\` int AUTO_INCREMENT NOT NULL, \`userId\` int, \`email\` varchar(320) NOT NULL,
    \`requestedAt\` timestamp NOT NULL DEFAULT (now()), \`resolvedAt\` timestamp NULL, \`resolvedBy\` int,
    PRIMARY KEY (\`id\`), KEY \`password_reset_pending_idx\` (\`resolvedAt\`, \`requestedAt\`),
    KEY \`password_reset_user_idx\` (\`userId\`)
  )`,
];
