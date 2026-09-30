-- CODEX 017: a temporary password may only be used to complete the password gate.
ALTER TABLE `users`
  ADD COLUMN `mustChangePassword` boolean NOT NULL DEFAULT false;
