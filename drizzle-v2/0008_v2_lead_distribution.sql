CREATE TABLE `lead_distribution_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`campaignId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`actorMembershipId` int,
	`requestKey` varchar(96) NOT NULL,
	`type` enum('assign','reassign','return_to_queue','balanced') NOT NULL,
	`strategy` enum('manual','balanced') NOT NULL,
	`status` enum('processing','completed') NOT NULL DEFAULT 'processing',
	`requestedCount` int NOT NULL DEFAULT 0,
	`processedCount` int NOT NULL DEFAULT 0,
	`successCount` int NOT NULL DEFAULT 0,
	`skippedCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`metadataJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `lead_distribution_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_distribution_batches_partner_actor_request_unique` UNIQUE(`partnerId`,`actorUserId`,`requestKey`)
);
--> statement-breakpoint
ALTER TABLE `lead_timeline_events` MODIFY COLUMN `type` enum('lead_created','assigned','assignee_changed','status_changed','contact','note','follow_up_created','follow_up_completed','follow_up_cancelled','follow_up_rescheduled','lead_imported','import_updated','appointment','evidence','lead_distributed','lead_reassigned','lead_returned_to_queue','follow_up_owner_changed') NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_distribution_batches` ADD CONSTRAINT `lead_distribution_batches_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_distribution_batches` ADD CONSTRAINT `lead_distribution_batches_campaign_tenant_fk` FOREIGN KEY (`campaignId`,`partnerId`) REFERENCES `campaigns`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_distribution_batches` ADD CONSTRAINT `lead_distribution_batches_actor_user_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_distribution_batches` ADD CONSTRAINT `lead_distribution_batches_actor_membership_tenant_fk` FOREIGN KEY (`actorMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `lead_distribution_batches_partner_campaign_created_idx` ON `lead_distribution_batches` (`partnerId`,`campaignId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `lead_distribution_batches_partner_status_created_idx` ON `lead_distribution_batches` (`partnerId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `leads_partner_distribution_filter_idx` ON `leads` (`partnerId`,`campaignId`,`pdvId`,`statusId`,`assignedMembershipId`,`deletedAt`,`receivedAt`,`id`);--> statement-breakpoint
CREATE INDEX `leads_partner_campaign_activity_idx` ON `leads` (`partnerId`,`campaignId`,`deletedAt`,`lastActivityAt`,`id`);