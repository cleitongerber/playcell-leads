-- Additive migration: preserves the legacy store column and all existing leads.
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','supervisor','admin') NOT NULL DEFAULT 'user';
ALTER TABLE `users` ADD COLUMN `isActive` boolean NOT NULL DEFAULT true;

CREATE TABLE `pdvs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(120) NOT NULL,
  `code` varchar(60) NOT NULL,
  `city` varchar(120),
  `region` varchar(120),
  `managerUserId` int,
  `isActive` boolean NOT NULL DEFAULT true,
  `leadTarget` int,
  `conversionTarget` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `pdvs_id` PRIMARY KEY(`id`),
  CONSTRAINT `pdvs_code_unique` UNIQUE(`code`)
);
CREATE INDEX `pdvs_active_idx` ON `pdvs` (`isActive`);

CREATE TABLE `user_pdvs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `pdvId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `user_pdvs_id` PRIMARY KEY(`id`),
  CONSTRAINT `user_pdvs_user_pdv_unique` UNIQUE(`userId`,`pdvId`)
);
CREATE INDEX `user_pdvs_user_idx` ON `user_pdvs` (`userId`);
CREATE INDEX `user_pdvs_pdv_idx` ON `user_pdvs` (`pdvId`);

INSERT INTO `pdvs` (`name`, `code`)
SELECT DISTINCT `store`, CONCAT('LEGACY-', REPLACE(UPPER(`store`), ' ', '-')) FROM `leads`;
ALTER TABLE `leads` ADD COLUMN `pdvId` int;
ALTER TABLE `leads` ADD COLUMN `firstContactAt` timestamp NULL;
ALTER TABLE `leads` ADD COLUMN `deletedAt` timestamp NULL;
UPDATE `leads` l INNER JOIN `pdvs` p ON p.`name` = l.`store` SET l.`pdvId` = p.`id`;
INSERT IGNORE INTO `user_pdvs` (`userId`, `pdvId`)
SELECT s.`userId`, p.`id` FROM `seller_profiles` s INNER JOIN `pdvs` p ON p.`name` = s.`store`;
ALTER TABLE `leads` MODIFY COLUMN `status` enum('new','assigned','contacted','no_answer','interested','proposal','scheduled','converted','not_interested','invalid','callback','finalized') NOT NULL DEFAULT 'new';
ALTER TABLE `lead_activities` MODIFY COLUMN `action` enum('assigned','contact','status','note','created','follow_up','appointment','conversion','assignment_changed') NOT NULL;
CREATE INDEX `leads_pdv_idx` ON `leads` (`pdvId`);
CREATE INDEX `leads_created_idx` ON `leads` (`createdAt`);
CREATE INDEX `leads_updated_idx` ON `leads` (`updatedAt`);
CREATE INDEX `leads_available_idx` ON `leads` (`pdvId`,`assignedTo`,`status`);

CREATE TABLE `follow_ups` (
  `id` int AUTO_INCREMENT NOT NULL,
  `leadId` int NOT NULL,
  `createdBy` int NOT NULL,
  `dueAt` timestamp NOT NULL,
  `note` text,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `follow_ups_id` PRIMARY KEY(`id`)
);
CREATE INDEX `follow_ups_lead_due_idx` ON `follow_ups` (`leadId`,`dueAt`);
CREATE INDEX `follow_ups_due_idx` ON `follow_ups` (`dueAt`);
CREATE TABLE `audit_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int,
  `action` varchar(100) NOT NULL,
  `entityType` varchar(60) NOT NULL,
  `entityId` varchar(60),
  `details` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entityType`,`entityId`);
CREATE INDEX `audit_created_idx` ON `audit_logs` (`createdAt`);
CREATE INDEX `audit_user_idx` ON `audit_logs` (`userId`);
CREATE TABLE `notifications` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `type` varchar(60) NOT NULL,
  `title` varchar(180) NOT NULL,
  `body` text,
  `readAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`userId`,`createdAt`);
