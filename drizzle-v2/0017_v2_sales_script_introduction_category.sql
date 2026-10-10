-- CODEX 028: extend the closed sales-script category catalog.
ALTER TABLE `sales_scripts` MODIFY COLUMN `category` enum('opening','introduction','discovery','offer','objections','closing','follow_up') NOT NULL;
