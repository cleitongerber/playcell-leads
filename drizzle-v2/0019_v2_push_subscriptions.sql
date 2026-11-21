CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`userId` int NOT NULL,
	`membershipId` int NOT NULL,
	`endpointHash` varchar(64) NOT NULL,
	`endpointCiphertext` text NOT NULL,
	`keysCiphertext` text NOT NULL,
	`userAgentHash` varchar(64),
	`status` enum('active','revoked','invalid') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	`invalidatedAt` timestamp,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_membership_tenant_fk` FOREIGN KEY (`membershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `push_subscriptions_membership_status_idx` ON `push_subscriptions` (`partnerId`,`membershipId`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_partner_membership_endpoint_unique` ON `push_subscriptions` (`partnerId`,`membershipId`,`endpointHash`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_endpoint_hash_idx` ON `push_subscriptions` (`endpointHash`);
