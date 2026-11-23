CREATE TABLE `google_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`access_token_enc` text,
	`access_expires_at` integer,
	`account_email` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "google_connections_status_check" CHECK("status" IN ('ok', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_connections_owner_idx` ON `google_connections` (`owner_id`);--> statement-breakpoint
CREATE TABLE `google_synced_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`google_calendar_id` text NOT NULL,
	`reminders` integer DEFAULT true NOT NULL,
	`sync_token` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer,
	`next_sync_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `google_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "google_synced_calendars_status_check" CHECK("status" IN ('pending', 'ok', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_synced_calendars_calendar_idx` ON `google_synced_calendars` (`calendar_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `google_synced_calendars_google_idx` ON `google_synced_calendars` (`connection_id`,`google_calendar_id`);--> statement-breakpoint
CREATE INDEX `google_synced_calendars_owner_idx` ON `google_synced_calendars` (`owner_id`);--> statement-breakpoint
CREATE INDEX `google_synced_calendars_due_idx` ON `google_synced_calendars` (`next_sync_at`);