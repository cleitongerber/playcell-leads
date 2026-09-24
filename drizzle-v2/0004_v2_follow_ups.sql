CREATE TABLE `follow_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`leadId` int NOT NULL,
	`ownerMembershipId` int NOT NULL,
	`rescheduledFromId` int,
	`dueAt` timestamp NOT NULL,
	`status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
	`note` text,
	`completedAt` timestamp,
	`cancelledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `follow_ups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `lead_timeline_events` MODIFY COLUMN `type` enum('lead_created','assigned','assignee_changed','status_changed','contact','note','follow_up_created','follow_up_completed','follow_up_cancelled','follow_up_rescheduled','appointment','evidence') NOT NULL;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_lead_tenant_fk` FOREIGN KEY (`leadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_owner_tenant_fk` FOREIGN KEY (`ownerMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_rescheduled_from_fk` FOREIGN KEY (`rescheduledFromId`) REFERENCES `follow_ups`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `follow_ups_partner_owner_status_due_idx` ON `follow_ups` (`partnerId`,`ownerMembershipId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `follow_ups_partner_lead_status_due_idx` ON `follow_ups` (`partnerId`,`leadId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `follow_ups_partner_status_due_idx` ON `follow_ups` (`partnerId`,`status`,`dueAt`);