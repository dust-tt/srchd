PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`thinking` text NOT NULL,
	`tools` text NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agents`("id", "created", "updated", "experiment", "name", "provider", "model", "thinking", "tools") SELECT "id", "created", "updated", "experiment", "name", "provider", "model", "thinking", "tools" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_experiment_unique` ON `agents` (`name`,`experiment`);--> statement-breakpoint
ALTER TABLE `experiments` ADD `uuid` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_uuid_unique` ON `experiments` (`uuid`);