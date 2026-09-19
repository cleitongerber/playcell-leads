CREATE TABLE `lead_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`userId` int NOT NULL,
	`action` enum('assigned','contact','status','note') NOT NULL,
	`channel` enum('whatsapp','phone','other'),
	`status` enum('new','assigned','contacted','no_answer','interested','proposal','scheduled','converted','not_interested','invalid','callback'),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`importedBy` int NOT NULL,
	`rowCount` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`phone` varchar(40) NOT NULL,
	`email` varchar(320),
	`store` varchar(80) NOT NULL,
	`segment` varchar(120),
	`priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`source` varchar(120) NOT NULL DEFAULT 'Importação manual',
	`status` enum('new','assigned','contacted','no_answer','interested','proposal','scheduled','converted','not_interested','invalid','callback') NOT NULL DEFAULT 'new',
	`assignedTo` int,
	`assignedAt` timestamp,
	`lastContactAt` timestamp,
	`nextFollowUpAt` timestamp,
	`lastContactChannel` enum('whatsapp','phone','other'),
	`lastNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seller_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`store` varchar(80) NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seller_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `seller_profiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `lead_activities_lead_idx` ON `lead_activities` (`leadId`);--> statement-breakpoint
CREATE INDEX `lead_activities_created_idx` ON `lead_activities` (`createdAt`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_store_idx` ON `leads` (`store`);--> statement-breakpoint
CREATE INDEX `leads_assigned_idx` ON `leads` (`assignedTo`);--> statement-breakpoint
CREATE INDEX `seller_profiles_store_idx` ON `seller_profiles` (`store`);