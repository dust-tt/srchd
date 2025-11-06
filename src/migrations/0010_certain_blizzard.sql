ALTER TABLE `experiments` ADD `uuid` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_uuid_unique` ON `experiments` (`uuid`);