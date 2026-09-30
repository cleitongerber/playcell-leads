-- 016.4: the separated operational model is now the only FLUXO journey.
-- Keep the rollout marker for schema compatibility, but make new partner
-- settings reflect the unified default without relying on it at runtime.
ALTER TABLE `partner_settings`
  MODIFY COLUMN `leadJourneyMode` enum('legacy','separated_contact_v1')
  NOT NULL DEFAULT 'separated_contact_v1';
