-- CODEX 020: multi-partner management viewers remain normal tenant
-- memberships, with a semantic ALL versus SPECIFIC PDV scope.
ALTER TABLE `user_partners`
  MODIFY COLUMN `role` enum('partner_admin','manager','seller','management') NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_partners`
  ADD COLUMN `pdvScopeMode` enum('all','specific') NOT NULL DEFAULT 'specific';
--> statement-breakpoint
CREATE INDEX `user_partners_user_role_active_idx`
  ON `user_partners` (`userId`,`role`,`isActive`);
