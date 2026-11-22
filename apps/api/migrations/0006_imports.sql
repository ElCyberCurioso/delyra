CREATE TABLE `calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`url_enc` text NOT NULL,
	`url_hint` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer,
	`next_sync_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_subscriptions_status_check" CHECK("status" IN ('pending', 'ok', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_subscriptions_calendar_idx` ON `calendar_subscriptions` (`calendar_id`);--> statement-breakpoint
CREATE INDEX `calendar_subscriptions_owner_idx` ON `calendar_subscriptions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `calendar_subscriptions_due_idx` ON `calendar_subscriptions` (`next_sync_at`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`filename` text,
	`size_bytes` integer,
	`preview` text,
	`options` text,
	`progress_done` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`report` text,
	`error` text,
	`google_token_enc` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "imports_status_check" CHECK("status" IN ('analyzing', 'ready', 'importing', 'succeeded', 'failed', 'expired')),
	CONSTRAINT "imports_source_check" CHECK("source" IN ('file', 'google'))
);
--> statement-breakpoint
CREATE INDEX `imports_owner_idx` ON `imports` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `calendars` ADD `read_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `ical_uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_ical_uid_idx` ON `events` (`calendar_id`,`ical_uid`) WHERE "ical_uid" IS NOT NULL AND "recurring_event_id" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `events_owner_uid_idx` ON `events` (`owner_id`,`ical_uid`) WHERE "ical_uid" IS NOT NULL;