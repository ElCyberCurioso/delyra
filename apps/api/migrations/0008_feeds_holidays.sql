CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_enc` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_accessed_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_calendar_idx` ON `calendar_feeds` (`calendar_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_idx` ON `calendar_feeds` (`token_hash`);--> statement-breakpoint
CREATE TABLE `public_holidays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`country` text NOT NULL,
	`year` integer NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`regions` text DEFAULT '' NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_holidays_lookup_idx` ON `public_holidays` (`country`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_holidays_unique_idx` ON `public_holidays` (`country`,`date`,`name`,`regions`);--> statement-breakpoint
CREATE INDEX `public_holidays_year_idx` ON `public_holidays` (`country`,`year`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `holiday_region` text DEFAULT 'ES-MD' NOT NULL;