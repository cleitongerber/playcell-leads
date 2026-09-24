CREATE TABLE `campaign_import_policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`campaignId` int NOT NULL,
	`policy` enum('reject','allow','update_safe_fields') NOT NULL DEFAULT 'reject',
	`matchStrategy` enum('phone','email','phone_or_email','phone_and_email') NOT NULL DEFAULT 'phone_or_email',
	`safeUpdateFields` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaign_import_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_import_policies_campaign_unique` UNIQUE(`campaignId`)
);
--> statement-breakpoint
CREATE TABLE `custom_field_definitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`entityType` enum('lead') NOT NULL DEFAULT 'lead',
	`key` varchar(96) NOT NULL,
	`label` varchar(160) NOT NULL,
	`fieldType` enum('text','number','date','boolean','select') NOT NULL,
	`optionsJson` json,
	`isRequired` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `custom_field_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `custom_field_definitions_partner_entity_key_unique` UNIQUE(`partnerId`,`entityType`,`key`),
	CONSTRAINT `custom_field_definitions_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `import_template_fields` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`templateVersionId` int NOT NULL,
	`sourceHeader` varchar(255) NOT NULL,
	`targetKind` enum('core','custom') NOT NULL,
	`targetKey` varchar(96) NOT NULL,
	`valueType` enum('text','number','date','boolean') NOT NULL DEFAULT 'text',
	`isRequired` boolean NOT NULL DEFAULT false,
	`transformKey` varchar(96),
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `import_template_fields_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_template_fields_version_header_unique` UNIQUE(`templateVersionId`,`sourceHeader`)
);
--> statement-breakpoint
CREATE TABLE `import_template_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`templateId` int NOT NULL,
	`versionNumber` int NOT NULL,
	`mappingFingerprint` varchar(128) NOT NULL,
	`createdByMembershipId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_template_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_template_versions_template_version_unique` UNIQUE(`templateId`,`versionNumber`),
	CONSTRAINT `import_template_versions_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `import_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`entityType` enum('lead') NOT NULL DEFAULT 'lead',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdByMembershipId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `import_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_templates_partner_name_unique` UNIQUE(`partnerId`,`name`),
	CONSTRAINT `import_templates_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `lead_import_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`campaignId` int NOT NULL,
	`templateVersionId` int,
	`importedByMembershipId` int,
	`targetPdvId` int,
	`fileName` varchar(255) NOT NULL,
	`fileSizeBytes` int NOT NULL,
	`fileChecksum` varchar(128) NOT NULL,
	`delimiter` varchar(1) NOT NULL,
	`headersJson` json NOT NULL,
	`duplicatePolicy` enum('reject','allow','update_safe_fields') NOT NULL DEFAULT 'reject',
	`duplicateMatchStrategy` enum('phone','email','phone_or_email','phone_and_email') NOT NULL DEFAULT 'phone_or_email',
	`safeUpdateFields` json,
	`totalRows` int NOT NULL DEFAULT 0,
	`validRows` int NOT NULL DEFAULT 0,
	`invalidRows` int NOT NULL DEFAULT 0,
	`importedRows` int NOT NULL DEFAULT 0,
	`duplicateRows` int NOT NULL DEFAULT 0,
	`rejectedRows` int NOT NULL DEFAULT 0,
	`updatedRows` int NOT NULL DEFAULT 0,
	`status` enum('draft','validated','processing','completed','failed') NOT NULL DEFAULT 'draft',
	`errorSummary` varchar(1000),
	`confirmedAt` timestamp,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_import_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_import_batches_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `lead_import_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`batchId` int NOT NULL,
	`rowNumber` int NOT NULL,
	`code` varchar(96) NOT NULL,
	`fieldKey` varchar(96),
	`details` varchar(1000) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_import_issues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_import_rows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`batchId` int NOT NULL,
	`rowNumber` int NOT NULL,
	`sourceRowJson` json NOT NULL,
	`mappedDataJson` json,
	`targetPdvId` int,
	`normalizedPhone` varchar(32),
	`normalizedEmail` varchar(320),
	`duplicateLeadId` int,
	`status` enum('staged','valid','invalid','duplicate','imported','updated','rejected') NOT NULL DEFAULT 'staged',
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_import_rows_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_import_rows_batch_row_unique` UNIQUE(`batchId`,`rowNumber`)
);
--> statement-breakpoint
CREATE TABLE `partner_import_policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`policy` enum('reject','allow','update_safe_fields') NOT NULL DEFAULT 'reject',
	`matchStrategy` enum('phone','email','phone_or_email','phone_and_email') NOT NULL DEFAULT 'phone_or_email',
	`safeUpdateFields` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partner_import_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_import_policies_partner_unique` UNIQUE(`partnerId`)
);
--> statement-breakpoint
ALTER TABLE `lead_timeline_events` MODIFY COLUMN `type` enum('lead_created','assigned','assignee_changed','status_changed','contact','note','follow_up_created','follow_up_completed','follow_up_cancelled','follow_up_rescheduled','lead_imported','import_updated','appointment','evidence') NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_import_policies` ADD CONSTRAINT `campaign_import_policies_campaign_tenant_fk` FOREIGN KEY (`campaignId`,`partnerId`) REFERENCES `campaigns`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `custom_field_definitions` ADD CONSTRAINT `custom_field_definitions_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_template_fields` ADD CONSTRAINT `import_template_fields_version_tenant_fk` FOREIGN KEY (`templateVersionId`,`partnerId`) REFERENCES `import_template_versions`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_template_versions` ADD CONSTRAINT `import_template_versions_template_tenant_fk` FOREIGN KEY (`templateId`,`partnerId`) REFERENCES `import_templates`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_template_versions` ADD CONSTRAINT `import_template_versions_creator_tenant_fk` FOREIGN KEY (`createdByMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_templates` ADD CONSTRAINT `import_templates_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_templates` ADD CONSTRAINT `import_templates_creator_tenant_fk` FOREIGN KEY (`createdByMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_batches` ADD CONSTRAINT `lead_import_batches_campaign_tenant_fk` FOREIGN KEY (`campaignId`,`partnerId`) REFERENCES `campaigns`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_batches` ADD CONSTRAINT `lead_import_batches_template_version_tenant_fk` FOREIGN KEY (`templateVersionId`,`partnerId`) REFERENCES `import_template_versions`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_batches` ADD CONSTRAINT `lead_import_batches_importer_tenant_fk` FOREIGN KEY (`importedByMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_batches` ADD CONSTRAINT `lead_import_batches_target_pdv_tenant_fk` FOREIGN KEY (`targetPdvId`,`partnerId`) REFERENCES `pdvs`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_issues` ADD CONSTRAINT `lead_import_issues_batch_tenant_fk` FOREIGN KEY (`batchId`,`partnerId`) REFERENCES `lead_import_batches`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_rows` ADD CONSTRAINT `lead_import_rows_batch_tenant_fk` FOREIGN KEY (`batchId`,`partnerId`) REFERENCES `lead_import_batches`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_rows` ADD CONSTRAINT `lead_import_rows_target_pdv_tenant_fk` FOREIGN KEY (`targetPdvId`,`partnerId`) REFERENCES `pdvs`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_import_rows` ADD CONSTRAINT `lead_import_rows_duplicate_lead_tenant_fk` FOREIGN KEY (`duplicateLeadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `partner_import_policies` ADD CONSTRAINT `partner_import_policies_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `campaign_import_policies_partner_campaign_idx` ON `campaign_import_policies` (`partnerId`,`campaignId`);--> statement-breakpoint
CREATE INDEX `custom_field_definitions_partner_active_order_idx` ON `custom_field_definitions` (`partnerId`,`entityType`,`isActive`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `import_template_fields_version_order_idx` ON `import_template_fields` (`partnerId`,`templateVersionId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `import_template_versions_partner_template_idx` ON `import_template_versions` (`partnerId`,`templateId`,`versionNumber`);--> statement-breakpoint
CREATE INDEX `import_templates_partner_active_idx` ON `import_templates` (`partnerId`,`isActive`);--> statement-breakpoint
CREATE INDEX `lead_import_batches_partner_campaign_created_idx` ON `lead_import_batches` (`partnerId`,`campaignId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `lead_import_batches_partner_status_idx` ON `lead_import_batches` (`partnerId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `lead_import_issues_batch_row_idx` ON `lead_import_issues` (`partnerId`,`batchId`,`rowNumber`,`id`);--> statement-breakpoint
CREATE INDEX `lead_import_rows_batch_status_row_idx` ON `lead_import_rows` (`partnerId`,`batchId`,`status`,`rowNumber`);--> statement-breakpoint
CREATE INDEX `lead_import_rows_partner_duplicate_idx` ON `lead_import_rows` (`partnerId`,`duplicateLeadId`);
--> statement-breakpoint
INSERT IGNORE INTO `partner_import_policies` (`partnerId`) SELECT `id` FROM `partners`;
