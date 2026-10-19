ALTER TABLE `leads` ADD `normalizedCpf` varchar(11);--> statement-breakpoint
CREATE INDEX `leads_partner_normalized_cpf_idx` ON `leads` (`partnerId`,`normalizedCpf`);--> statement-breakpoint
ALTER TABLE `partner_import_policies` ADD `duplicateIdentifiers` json;--> statement-breakpoint
ALTER TABLE `partner_import_policies` ADD `duplicateMatchVersion` varchar(32);--> statement-breakpoint
ALTER TABLE `campaign_import_policies` ADD `duplicateIdentifiers` json;--> statement-breakpoint
ALTER TABLE `campaign_import_policies` ADD `duplicateMatchVersion` varchar(32);--> statement-breakpoint
ALTER TABLE `lead_import_batches` ADD `duplicateIdentifiers` json;--> statement-breakpoint
ALTER TABLE `lead_import_batches` ADD `duplicateMatchVersion` varchar(32);--> statement-breakpoint
ALTER TABLE `lead_import_rows` ADD `normalizedCpf` varchar(11);--> statement-breakpoint
ALTER TABLE `lead_import_rows` ADD `duplicateReasonCodes` json;
