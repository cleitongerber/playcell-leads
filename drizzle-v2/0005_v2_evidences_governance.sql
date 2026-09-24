CREATE TABLE `campaign_governance_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`campaignId` int NOT NULL,
	`mode` enum('inherit','override') NOT NULL DEFAULT 'inherit',
	`evidenceRequired` boolean NOT NULL DEFAULT false,
	`noteRequired` boolean NOT NULL DEFAULT false,
	`followUpRequired` boolean NOT NULL DEFAULT false,
	`allowedChannels` json,
	`allowedOutcomes` json,
	`allowedEvidenceMimeTypes` json,
	`maxEvidenceSizeBytes` int NOT NULL DEFAULT 5242880,
	`retentionDays` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaign_governance_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_governance_overrides_campaign_unique` UNIQUE(`campaignId`)
);
--> statement-breakpoint
CREATE TABLE `lead_evidences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`leadId` int NOT NULL,
	`timelineEventId` int NOT NULL,
	`uploadedByMembershipId` int NOT NULL,
	`storageProvider` enum('forge_s3') NOT NULL DEFAULT 'forge_s3',
	`storageKey` varchar(512) NOT NULL,
	`storageStatus` enum('uploading','available','failed') NOT NULL DEFAULT 'uploading',
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`sizeBytes` int NOT NULL,
	`checksum` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`deletedAt` timestamp,
	CONSTRAINT `lead_evidences_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_evidences_storage_key_unique` UNIQUE(`storageKey`)
);
--> statement-breakpoint
CREATE TABLE `lead_treatment_governance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`leadId` int NOT NULL,
	`timelineEventId` int NOT NULL,
	`ruleSource` enum('partner','campaign') NOT NULL,
	`appliedRuleJson` json NOT NULL,
	`noteSatisfied` boolean NOT NULL DEFAULT true,
	`followUpSatisfied` boolean NOT NULL DEFAULT true,
	`evidenceSatisfied` boolean NOT NULL DEFAULT true,
	`isComplete` boolean NOT NULL DEFAULT true,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_treatment_governance_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_treatment_governance_partner_event_unique` UNIQUE(`partnerId`,`timelineEventId`)
);
--> statement-breakpoint
CREATE TABLE `partner_governance_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`evidenceRequired` boolean NOT NULL DEFAULT false,
	`noteRequired` boolean NOT NULL DEFAULT false,
	`followUpRequired` boolean NOT NULL DEFAULT false,
	`allowedChannels` json,
	`allowedOutcomes` json,
	`allowedEvidenceMimeTypes` json,
	`maxEvidenceSizeBytes` int NOT NULL DEFAULT 5242880,
	`retentionDays` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partner_governance_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_governance_rules_partner_unique` UNIQUE(`partnerId`)
);
--> statement-breakpoint
ALTER TABLE `lead_timeline_events` ADD CONSTRAINT `lead_timeline_events_id_partner_lead_unique` UNIQUE(`id`,`partnerId`,`leadId`);--> statement-breakpoint
ALTER TABLE `campaign_governance_overrides` ADD CONSTRAINT `campaign_governance_overrides_campaign_tenant_fk` FOREIGN KEY (`campaignId`,`partnerId`) REFERENCES `campaigns`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_evidences` ADD CONSTRAINT `lead_evidences_lead_tenant_fk` FOREIGN KEY (`leadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_evidences` ADD CONSTRAINT `lead_evidences_timeline_lead_tenant_fk` FOREIGN KEY (`timelineEventId`,`partnerId`,`leadId`) REFERENCES `lead_timeline_events`(`id`,`partnerId`,`leadId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_evidences` ADD CONSTRAINT `lead_evidences_uploader_tenant_fk` FOREIGN KEY (`uploadedByMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_treatment_governance` ADD CONSTRAINT `lead_treatment_governance_lead_tenant_fk` FOREIGN KEY (`leadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_treatment_governance` ADD CONSTRAINT `lead_treatment_governance_timeline_lead_tenant_fk` FOREIGN KEY (`timelineEventId`,`partnerId`,`leadId`) REFERENCES `lead_timeline_events`(`id`,`partnerId`,`leadId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `partner_governance_rules` ADD CONSTRAINT `partner_governance_rules_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `campaign_governance_overrides_partner_campaign_idx` ON `campaign_governance_overrides` (`partnerId`,`campaignId`,`mode`);--> statement-breakpoint
CREATE INDEX `lead_evidences_partner_event_active_idx` ON `lead_evidences` (`partnerId`,`timelineEventId`,`deletedAt`,`storageStatus`);--> statement-breakpoint
CREATE INDEX `lead_evidences_partner_lead_created_idx` ON `lead_evidences` (`partnerId`,`leadId`,`deletedAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `lead_treatment_governance_lead_completion_idx` ON `lead_treatment_governance` (`partnerId`,`leadId`,`isComplete`,`createdAt`);
--> statement-breakpoint
-- V2 partners created before this migration inherit a permissive default.
INSERT IGNORE INTO `partner_governance_rules` (`partnerId`)
SELECT `id` FROM `partners`;
