ALTER TABLE `follow_ups` ADD `notificationVersion` int NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE `follow_up_notification_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`followUpId` int NOT NULL,
	`notificationVersion` int NOT NULL,
	`stage` enum('PRE30','DUE','LATE60') NOT NULL,
	`subscriptionId` int NOT NULL,
	`scheduledFor` timestamp NOT NULL,
	`eligibleUntil` timestamp NOT NULL,
	`status` enum('pending','sending','sent','failed','invalid','suppressed','abandoned') NOT NULL DEFAULT 'pending',
	`claimToken` varchar(64),
	`claimedAt` timestamp,
	`processedAt` timestamp,
	`providerStatus` int,
	`outcomeCode` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `follow_up_notification_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `follow_up_notification_deliveries` ADD CONSTRAINT `follow_up_notification_deliveries_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `follow_up_notification_deliveries` ADD CONSTRAINT `follow_up_notification_deliveries_follow_up_fk` FOREIGN KEY (`followUpId`) REFERENCES `follow_ups`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `follow_up_notification_deliveries` ADD CONSTRAINT `follow_up_notification_deliveries_subscription_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `push_subscriptions`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_up_notification_delivery_unique` ON `follow_up_notification_deliveries` (`followUpId`,`notificationVersion`,`stage`,`subscriptionId`);
--> statement-breakpoint
CREATE INDEX `follow_up_notification_deliveries_partner_status_scheduled_idx` ON `follow_up_notification_deliveries` (`partnerId`,`status`,`scheduledFor`);
--> statement-breakpoint
CREATE INDEX `follow_up_notification_deliveries_follow_up_version_idx` ON `follow_up_notification_deliveries` (`followUpId`,`notificationVersion`);
