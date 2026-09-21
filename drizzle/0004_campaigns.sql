-- Campaigns are additive: historical leads remain untouched and have a null campaignId.
CREATE TABLE `campaigns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdBy` int NOT NULL,
  `deletedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
CREATE INDEX `campaigns_active_idx` ON `campaigns` (`isActive`);
CREATE INDEX `campaigns_created_idx` ON `campaigns` (`createdAt`);

CREATE TABLE `campaign_pdvs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaignId` int NOT NULL,
  `pdvId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `campaign_pdvs_id` PRIMARY KEY(`id`),
  CONSTRAINT `campaign_pdvs_campaign_pdv_unique` UNIQUE(`campaignId`,`pdvId`)
);
CREATE INDEX `campaign_pdvs_campaign_idx` ON `campaign_pdvs` (`campaignId`);
CREATE INDEX `campaign_pdvs_pdv_idx` ON `campaign_pdvs` (`pdvId`);

ALTER TABLE `leads` ADD COLUMN `campaignId` int;
CREATE INDEX `leads_campaign_idx` ON `leads` (`campaignId`);
