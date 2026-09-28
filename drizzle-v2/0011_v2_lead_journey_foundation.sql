CREATE TABLE `lead_contact_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`leadId` int NOT NULL,
	`actorMembershipId` int NOT NULL,
	`timelineEventId` int NOT NULL,
	`channel` varchar(48) NOT NULL,
	`resultId` int NOT NULL,
	`resultCode` varchar(64) NOT NULL,
	`resultLabel` varchar(120) NOT NULL,
	`resultCategory` varchar(64) NOT NULL,
	`summary` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_contact_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_conversions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`leadId` int NOT NULL,
	`effectiveContactId` int NOT NULL,
	`timelineEventId` int NOT NULL,
	`resultId` int NOT NULL,
	`statusId` int NOT NULL,
	`actorMembershipId` int NOT NULL,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_conversions_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_conversions_partner_effective_contact_unique` UNIQUE(`partnerId`,`effectiveContactId`)
);
--> statement-breakpoint
CREATE TABLE `lead_interaction_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`interactionKind` enum('attempt','effective_contact') NOT NULL,
	`code` varchar(64) NOT NULL,
	`label` varchar(120) NOT NULL,
	`category` varchar(64) NOT NULL,
	`suggestedStatusId` int,
	`statusPolicy` enum('none','suggest','require') NOT NULL DEFAULT 'none',
	`allowSellerOverride` boolean NOT NULL DEFAULT true,
	`followUpPolicy` enum('not_applicable','optional','required') NOT NULL DEFAULT 'not_applicable',
	`conversionMode` enum('none','eligible') NOT NULL DEFAULT 'none',
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_interaction_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_interaction_results_partner_kind_code_unique` UNIQUE(`partnerId`,`interactionKind`,`code`),
	CONSTRAINT `lead_interaction_results_id_partner_unique` UNIQUE(`id`,`partnerId`)
);
--> statement-breakpoint
CREATE TABLE `lead_operation_commands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`actorMembershipId` int,
	`operationType` varchar(64) NOT NULL,
	`requestKey` varchar(96) NOT NULL,
	`status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
	`resultReferenceType` varchar(64),
	`resultReferenceId` varchar(96),
	`failureCode` varchar(96),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lead_operation_commands_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_operation_commands_partner_actor_operation_request_unique` UNIQUE(`partnerId`,`actorUserId`,`operationType`,`requestKey`)
);
--> statement-breakpoint
ALTER TABLE `lead_timeline_events` MODIFY COLUMN `type` enum('lead_created','assigned','assignee_changed','status_changed','contact','note','follow_up_created','follow_up_completed','follow_up_cancelled','follow_up_rescheduled','lead_imported','import_updated','appointment','evidence','lead_distributed','lead_reassigned','lead_returned_to_queue','follow_up_owner_changed','contact_attempted','effective_contact_recorded','conversion_recorded','lead_reopened','administrative_status_changed') NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_governance_overrides` ADD `attemptMode` enum('inherit','override') DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_governance_overrides` ADD `attemptEvidenceRequired` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_governance_overrides` ADD `attemptEvidenceRequiredChannels` json;--> statement-breakpoint
ALTER TABLE `campaign_governance_overrides` ADD `attemptNoteRequired` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_governance_overrides` ADD `attemptAllowedChannels` json;--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `originTimelineEventId` int;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD `recordKind` enum('legacy','effective_contact') DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD `timelineEventId` int;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD `resultId` int;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD `resultCode` varchar(64);--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD `resultLabel` varchar(120);--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD `resultCategory` varchar(64);--> statement-breakpoint
ALTER TABLE `lead_treatment_governance` ADD `operationKind` enum('legacy_contact','attempt','effective_contact') DEFAULT 'legacy_contact' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `firstAttemptAt` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `firstEffectiveContactAt` timestamp;--> statement-breakpoint
ALTER TABLE `partner_governance_rules` ADD `attemptEvidenceRequired` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `partner_governance_rules` ADD `attemptEvidenceRequiredChannels` json;--> statement-breakpoint
ALTER TABLE `partner_governance_rules` ADD `attemptNoteRequired` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `partner_governance_rules` ADD `attemptAllowedChannels` json;--> statement-breakpoint
ALTER TABLE `partner_settings` ADD `leadJourneyMode` enum('legacy','separated_contact_v1') DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD CONSTRAINT `lead_contacts_id_partner_lead_unique` UNIQUE(`id`,`partnerId`,`leadId`);--> statement-breakpoint
ALTER TABLE `lead_contact_attempts` ADD CONSTRAINT `lead_contact_attempts_lead_tenant_fk` FOREIGN KEY (`leadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_contact_attempts` ADD CONSTRAINT `lead_contact_attempts_actor_tenant_fk` FOREIGN KEY (`actorMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_contact_attempts` ADD CONSTRAINT `lead_contact_attempts_timeline_lead_tenant_fk` FOREIGN KEY (`timelineEventId`,`partnerId`,`leadId`) REFERENCES `lead_timeline_events`(`id`,`partnerId`,`leadId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_contact_attempts` ADD CONSTRAINT `lead_contact_attempts_result_tenant_fk` FOREIGN KEY (`resultId`,`partnerId`) REFERENCES `lead_interaction_results`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_conversions` ADD CONSTRAINT `lead_conversions_lead_tenant_fk` FOREIGN KEY (`leadId`,`partnerId`) REFERENCES `leads`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_conversions` ADD CONSTRAINT `lead_conversions_effective_contact_tenant_fk` FOREIGN KEY (`effectiveContactId`,`partnerId`,`leadId`) REFERENCES `lead_contacts`(`id`,`partnerId`,`leadId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_conversions` ADD CONSTRAINT `lead_conversions_timeline_lead_tenant_fk` FOREIGN KEY (`timelineEventId`,`partnerId`,`leadId`) REFERENCES `lead_timeline_events`(`id`,`partnerId`,`leadId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_conversions` ADD CONSTRAINT `lead_conversions_result_tenant_fk` FOREIGN KEY (`resultId`,`partnerId`) REFERENCES `lead_interaction_results`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_conversions` ADD CONSTRAINT `lead_conversions_status_tenant_fk` FOREIGN KEY (`statusId`,`partnerId`) REFERENCES `lead_statuses`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_conversions` ADD CONSTRAINT `lead_conversions_actor_tenant_fk` FOREIGN KEY (`actorMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_interaction_results` ADD CONSTRAINT `lead_interaction_results_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_interaction_results` ADD CONSTRAINT `lead_interaction_results_status_tenant_fk` FOREIGN KEY (`suggestedStatusId`,`partnerId`) REFERENCES `lead_statuses`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_operation_commands` ADD CONSTRAINT `lead_operation_commands_partner_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_operation_commands` ADD CONSTRAINT `lead_operation_commands_actor_user_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_operation_commands` ADD CONSTRAINT `lead_operation_commands_actor_membership_tenant_fk` FOREIGN KEY (`actorMembershipId`,`partnerId`) REFERENCES `user_partners`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `lead_contact_attempts_partner_lead_occurred_idx` ON `lead_contact_attempts` (`partnerId`,`leadId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_contact_attempts_partner_actor_occurred_idx` ON `lead_contact_attempts` (`partnerId`,`actorMembershipId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_contact_attempts_partner_result_occurred_idx` ON `lead_contact_attempts` (`partnerId`,`resultId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_conversions_partner_occurred_idx` ON `lead_conversions` (`partnerId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_conversions_partner_lead_occurred_idx` ON `lead_conversions` (`partnerId`,`leadId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_interaction_results_partner_kind_active_order_idx` ON `lead_interaction_results` (`partnerId`,`interactionKind`,`isActive`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `lead_operation_commands_partner_status_created_idx` ON `lead_operation_commands` (`partnerId`,`status`,`createdAt`);--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_origin_timeline_lead_tenant_fk` FOREIGN KEY (`originTimelineEventId`,`partnerId`,`leadId`) REFERENCES `lead_timeline_events`(`id`,`partnerId`,`leadId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD CONSTRAINT `lead_contacts_timeline_lead_tenant_fk` FOREIGN KEY (`timelineEventId`,`partnerId`,`leadId`) REFERENCES `lead_timeline_events`(`id`,`partnerId`,`leadId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lead_contacts` ADD CONSTRAINT `lead_contacts_result_tenant_fk` FOREIGN KEY (`resultId`,`partnerId`) REFERENCES `lead_interaction_results`(`id`,`partnerId`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `follow_ups_partner_origin_timeline_idx` ON `follow_ups` (`partnerId`,`originTimelineEventId`);--> statement-breakpoint
CREATE INDEX `leads_partner_first_attempt_idx` ON `leads` (`partnerId`,`firstAttemptAt`);--> statement-breakpoint
CREATE INDEX `leads_partner_first_effective_contact_idx` ON `leads` (`partnerId`,`firstEffectiveContactAt`);--> statement-breakpoint
-- Seed only stable codes. Labels remain configurable, and status links are
-- resolved within each tenant rather than using a global status identifier.
INSERT IGNORE INTO `lead_interaction_results` (
	`partnerId`,
	`interactionKind`,
	`code`,
	`label`,
	`category`,
	`suggestedStatusId`,
	`statusPolicy`,
	`allowSellerOverride`,
	`followUpPolicy`,
	`conversionMode`,
	`isActive`,
	`sortOrder`
)
SELECT
	`partners`.`id`,
	`defaults`.`interactionKind`,
	`defaults`.`code`,
	`defaults`.`label`,
	`defaults`.`category`,
	`statuses`.`id`,
	`defaults`.`statusPolicy`,
	`defaults`.`allowSellerOverride`,
	`defaults`.`followUpPolicy`,
	`defaults`.`conversionMode`,
	true,
	`defaults`.`sortOrder`
FROM `partners`
CROSS JOIN (
	SELECT 'attempt' AS `interactionKind`, 'message_sent' AS `code`, 'Mensagem enviada' AS `label`, 'awaiting_response' AS `category`, NULL AS `suggestedStatusCode`, 'none' AS `statusPolicy`, true AS `allowSellerOverride`, 'optional' AS `followUpPolicy`, 'none' AS `conversionMode`, 10 AS `sortOrder`
	UNION ALL SELECT 'attempt', 'no_answer', 'Não atendeu', 'unreachable', NULL, 'none', true, 'optional', 'none', 20
	UNION ALL SELECT 'attempt', 'busy', 'Ocupado', 'unreachable', NULL, 'none', true, 'optional', 'none', 30
	UNION ALL SELECT 'attempt', 'voicemail', 'Caixa postal', 'unreachable', NULL, 'none', true, 'optional', 'none', 40
	UNION ALL SELECT 'attempt', 'invalid_contact', 'Número inválido', 'invalid_contact', NULL, 'none', true, 'not_applicable', 'none', 50
	UNION ALL SELECT 'attempt', 'other_attempt', 'Outro', 'other', NULL, 'none', true, 'optional', 'none', 60
	UNION ALL SELECT 'effective_contact', 'interested', 'Interessado', 'interested', 'qualified', 'suggest', true, 'optional', 'none', 10
	UNION ALL SELECT 'effective_contact', 'return_later', 'Retornar depois', 'follow_up', 'contacted', 'suggest', true, 'required', 'none', 20
	UNION ALL SELECT 'effective_contact', 'not_interested', 'Não interessado', 'negative', 'lost', 'require', false, 'not_applicable', 'none', 30
	UNION ALL SELECT 'effective_contact', 'sale_completed', 'Venda realizada', 'conversion', 'converted', 'require', false, 'not_applicable', 'eligible', 40
	UNION ALL SELECT 'effective_contact', 'other_contact', 'Outro', 'other', NULL, 'none', true, 'optional', 'none', 50
) AS `defaults`
LEFT JOIN `lead_statuses` AS `statuses`
	ON `statuses`.`partnerId` = `partners`.`id`
	AND `statuses`.`code` = `defaults`.`suggestedStatusCode`;
