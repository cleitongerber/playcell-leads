-- CODEX 027: optional, partner-owned sales-script library.
CREATE TABLE `sales_scripts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `partnerId` int NOT NULL,
  `title` varchar(160) NOT NULL,
  `category` enum('opening','discovery','offer','objections','closing','follow_up') NOT NULL,
  `content` text NOT NULL,
  `scope` enum('all_campaigns','specific_campaigns') NOT NULL DEFAULT 'all_campaigns',
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `sales_scripts_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `sales_scripts_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE INDEX `sales_scripts_partner_category_order_idx` ON `sales_scripts` (`partnerId`,`category`,`sortOrder`);
--> statement-breakpoint
CREATE TABLE `sales_script_campaigns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `partnerId` int NOT NULL,
  `salesScriptId` int NOT NULL,
  `campaignId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `sales_script_campaigns_script_campaign_unique` UNIQUE(`salesScriptId`,`campaignId`),
  CONSTRAINT `sales_script_campaigns_script_tenant_fk` FOREIGN KEY (`salesScriptId`,`partnerId`) REFERENCES `sales_scripts`(`id`,`partnerId`) ON DELETE RESTRICT,
  CONSTRAINT `sales_script_campaigns_campaign_tenant_fk` FOREIGN KEY (`campaignId`,`partnerId`) REFERENCES `campaigns`(`id`,`partnerId`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `sales_script_campaigns_partner_campaign_idx` ON `sales_script_campaigns` (`partnerId`,`campaignId`);
--> statement-breakpoint
CREATE TABLE `partner_sales_script_libraries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `partnerId` int NOT NULL,
  `seedVersion` varchar(32) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `partner_sales_script_libraries_partner_unique` UNIQUE(`partnerId`),
  CONSTRAINT `partner_sales_script_libraries_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE RESTRICT
);
