-- Local credentials for the independent Render deployment. Existing OAuth users remain intact.
ALTER TABLE `users` ADD COLUMN `passwordHash` varchar(255);
