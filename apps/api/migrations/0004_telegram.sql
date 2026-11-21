CREATE TABLE `notification_deliveries` (
	`key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_deliveries_status_check" CHECK("status" IN ('sending', 'sent', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_created_idx` ON `notification_deliveries` (`created_at`);--> statement-breakpoint
CREATE TABLE `telegram_link_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_link_tokens_hash_idx` ON `telegram_link_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`chat_id_enc` text NOT NULL,
	`chat_hash` text NOT NULL,
	`linked_at` integer NOT NULL,
	`muted_until` integer,
	`digest_time` text,
	`quiet_start` text,
	`quiet_end` text,
	`last_digest_on` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_chat_idx` ON `telegram_links` (`chat_hash`);--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `reminders` ADD `next_occurrence_start` integer;--> statement-breakpoint
ALTER TABLE `reminders` ADD `enqueued_at` integer;--> statement-breakpoint
ALTER TABLE `reminders` ADD `snooze_until` integer;--> statement-breakpoint
ALTER TABLE `reminders` ADD `snooze_occurrence_start` integer;--> statement-breakpoint
CREATE INDEX `reminders_snooze_idx` ON `reminders` (`snooze_until`);