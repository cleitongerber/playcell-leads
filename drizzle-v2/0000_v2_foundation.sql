CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int,
	`actorUserId` int,
	`actorMembershipId` int,
	`action` varchar(120) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` varchar(96),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partner_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'America/Sao_Paulo',
	`claimSlaMinutes` int NOT NULL DEFAULT 5,
	`firstContactSlaMinutes` int NOT NULL DEFAULT 15,
	`staleLeadMinutes` int NOT NULL DEFAULT 1440,
	`notificationSettings` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partner_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_settings_partner_unique` UNIQUE(`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partners_id` PRIMARY KEY(`id`),
	CONSTRAINT `partners_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `user_partners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`partnerId` int NOT NULL,
	`role` enum('partner_admin','manager','seller') NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_partners_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_partners_user_partner_unique` UNIQUE(`userId`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(96) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(160) NOT NULL,
	`passwordHash` varchar(255),
	`loginMethod` varchar(64) NOT NULL DEFAULT 'password',
	`systemRole` enum('none','super_admin') NOT NULL DEFAULT 'none',
	`isActive` boolean NOT NULL DEFAULT true,
	`lastSignedInAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_open_id_unique` UNIQUE(`openId`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_membership_fk` FOREIGN KEY (`actorMembershipId`) REFERENCES `user_partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `partner_settings` ADD CONSTRAINT `partner_settings_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_partners` ADD CONSTRAINT `user_partners_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_partners` ADD CONSTRAINT `user_partners_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_partner_entity_created_idx` ON `audit_logs` (`partnerId`,`entityType`,`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `partners_active_idx` ON `partners` (`isActive`);--> statement-breakpoint
CREATE INDEX `user_partners_partner_role_active_idx` ON `user_partners` (`partnerId`,`role`,`isActive`);--> statement-breakpoint
CREATE INDEX `user_partners_user_active_idx` ON `user_partners` (`userId`,`isActive`);--> statement-breakpoint
CREATE INDEX `users_active_idx` ON `users` (`isActive`);