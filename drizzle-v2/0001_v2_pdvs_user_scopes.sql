CREATE TABLE `pdvs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`city` varchar(120),
	`region` varchar(120),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pdvs_id` PRIMARY KEY(`id`),
	CONSTRAINT `pdvs_partner_code_unique` UNIQUE(`partnerId`,`code`),
	CONSTRAINT `pdvs_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `user_pdv_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`membershipId` int NOT NULL,
	`pdvId` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_pdv_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_pdv_assignments_membership_pdv_unique` UNIQUE(`membershipId`,`pdvId`)
);
--> statement-breakpoint
ALTER TABLE `user_partners` ADD CONSTRAINT `user_partners_id_partner_unique` UNIQUE(`id`,`partnerId`);--> statement-breakpoint
ALTER TABLE `pdvs` ADD CONSTRAINT `pdvs_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_pdv_assignments` ADD CONSTRAINT `user_pdv_assignments_membership_tenant_fk` FOREIGN KEY (`membershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_pdv_assignments` ADD CONSTRAINT `user_pdv_assignments_pdv_tenant_fk` FOREIGN KEY (`pdvId`,`partnerId`) REFERENCES `pdvs`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pdvs_partner_active_idx` ON `pdvs` (`partnerId`,`isActive`);--> statement-breakpoint
CREATE INDEX `user_pdv_assignments_membership_active_idx` ON `user_pdv_assignments` (`membershipId`,`isActive`);--> statement-breakpoint
CREATE INDEX `user_pdv_assignments_pdv_active_idx` ON `user_pdv_assignments` (`partnerId`,`pdvId`,`isActive`);