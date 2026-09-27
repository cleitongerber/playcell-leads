ALTER TABLE `campaign_governance_overrides` ADD `evidenceRequiredChannels` json;--> statement-breakpoint
ALTER TABLE `partner_governance_rules` ADD `evidenceRequiredChannels` json;--> statement-breakpoint
ALTER TABLE `partner_settings` ADD `whatsappInitialMessageTemplate` varchar(4000) DEFAULT 'Olá, {{primeiro_nome}}! Tudo bem? Meu nome é {{vendedor}} e estou entrando em contato para dar continuidade ao seu atendimento.' NOT NULL;
