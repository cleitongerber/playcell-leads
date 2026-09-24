CREATE TABLE `campaign_pdvs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`campaignId` int NOT NULL,
	`pdvId` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaign_pdvs_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_pdvs_campaign_pdv_unique` UNIQUE(`campaignId`,`pdvId`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`status` enum('draft','active','closed','archived') NOT NULL DEFAULT 'draft',
	`isFrozen` boolean NOT NULL DEFAULT false,
	`startsAt` timestamp,
	`endsAt` timestamp,
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaigns_partner_code_unique` UNIQUE(`partnerId`,`code`),
	CONSTRAINT `campaigns_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
ALTER TABLE `campaign_pdvs` ADD CONSTRAINT `campaign_pdvs_campaign_tenant_fk` FOREIGN KEY (`campaignId`,`partnerId`) REFERENCES `campaigns`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `campaign_pdvs` ADD CONSTRAINT `campaign_pdvs_pdv_tenant_fk` FOREIGN KEY (`pdvId`,`partnerId`) REFERENCES `pdvs`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `campaign_pdvs_campaign_active_idx` ON `campaign_pdvs` (`partnerId`,`campaignId`,`isActive`);--> statement-breakpoint
CREATE INDEX `campaign_pdvs_pdv_active_idx` ON `campaign_pdvs` (`partnerId`,`pdvId`,`isActive`);--> statement-breakpoint
CREATE INDEX `campaigns_partner_status_idx` ON `campaigns` (`partnerId`,`status`,`isFrozen`);