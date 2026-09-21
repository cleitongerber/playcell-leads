CREATE TABLE `password_reset_requests` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int,
  `email` varchar(320) NOT NULL,
  `requestedAt` timestamp NOT NULL DEFAULT (now()),
  `resolvedAt` timestamp NULL,
  `resolvedBy` int,
  CONSTRAINT `password_reset_requests_id` PRIMARY KEY(`id`)
);
CREATE INDEX `password_reset_pending_idx` ON `password_reset_requests` (`resolvedAt`,`requestedAt`);
CREATE INDEX `password_reset_user_idx` ON `password_reset_requests` (`userId`);
