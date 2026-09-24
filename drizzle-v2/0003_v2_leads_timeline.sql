CREATE TABLE `lead_contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`leadId` int NOT NULL,
	`actorMembershipId` int NOT NULL,
	`channel` varchar(48) NOT NULL,
	`outcome` varchar(96) NOT NULL,
	`summary` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`code` varchar(64) NOT NULL,
	`label` varchar(120) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_sources_partner_code_unique` UNIQUE(`partnerId`,`code`),
	CONSTRAINT `lead_sources_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `lead_statuses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`code` varchar(64) NOT NULL,
	`label` varchar(120) NOT NULL,
	`category` enum('open','in_progress','completed','discarded') NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isTerminal` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_statuses_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_statuses_partner_code_unique` UNIQUE(`partnerId`,`code`),
	CONSTRAINT `lead_statuses_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `lead_timeline_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`leadId` int NOT NULL,
	`actorMembershipId` int,
	`type` enum('lead_created','assigned','assignee_changed','status_changed','contact','note','follow_up','appointment','evidence') NOT NULL,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`payloadJson` json,
	`visibility` enum('partner','restricted') NOT NULL DEFAULT 'partner',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_timeline_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`campaignId` int NOT NULL,
	`pdvId` int NOT NULL,
	`statusId` int NOT NULL,
	`sourceId` int,
	`assignedMembershipId` int,
	`name` varchar(200),
	`phone` varchar(64),
	`normalizedPhone` varchar(32),
	`email` varchar(320),
	`customData` json,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`assignedAt` timestamp,
	`firstContactAt` timestamp,
	`lastActivityAt` timestamp,
	`nextFollowUpAt` timestamp,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `leads_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD CONSTRAINT `lead_contacts_lead_tenant_fk` FOREIGN KEY (`leadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD CONSTRAINT `lead_contacts_actor_tenant_fk` FOREIGN KEY (`actorMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_sources` ADD CONSTRAINT `lead_sources_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_statuses` ADD CONSTRAINT `lead_statuses_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_timeline_events` ADD CONSTRAINT `lead_timeline_events_lead_tenant_fk` FOREIGN KEY (`leadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_timeline_events` ADD CONSTRAINT `lead_timeline_events_actor_tenant_fk` FOREIGN KEY (`actorMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_campaign_tenant_fk` FOREIGN KEY (`campaignId`,`partnerId`) REFERENCES `campaigns`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_pdv_tenant_fk` FOREIGN KEY (`pdvId`,`partnerId`) REFERENCES `pdvs`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_status_tenant_fk` FOREIGN KEY (`statusId`,`partnerId`) REFERENCES `lead_statuses`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_source_tenant_fk` FOREIGN KEY (`sourceId`,`partnerId`) REFERENCES `lead_sources`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_assignee_tenant_fk` FOREIGN KEY (`assignedMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `lead_contacts_lead_occurred_idx` ON `lead_contacts` (`partnerId`,`leadId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_sources_partner_active_idx` ON `lead_sources` (`partnerId`,`isActive`);--> statement-breakpoint
CREATE INDEX `lead_statuses_partner_order_idx` ON `lead_statuses` (`partnerId`,`sortOrder`,`isActive`);--> statement-breakpoint
CREATE INDEX `lead_timeline_events_lead_chronological_idx` ON `lead_timeline_events` (`partnerId`,`leadId`,`occurredAt`,`id`);--> statement-breakpoint
CREATE INDEX `leads_partner_campaign_idx` ON `leads` (`partnerId`,`campaignId`,`deletedAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `leads_partner_pdv_queue_idx` ON `leads` (`partnerId`,`pdvId`,`assignedMembershipId`,`deletedAt`);--> statement-breakpoint
CREATE INDEX `leads_partner_assignee_idx` ON `leads` (`partnerId`,`assignedMembershipId`,`deletedAt`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `leads_partner_normalized_phone_idx` ON `leads` (`partnerId`,`normalizedPhone`);
