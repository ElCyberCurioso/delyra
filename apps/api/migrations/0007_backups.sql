CREATE TABLE `user_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer,
	`counts` text,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_backups_kind_check" CHECK("kind" IN ('manual', 'auto', 'pre_restore')),
	CONSTRAINT "user_backups_status_check" CHECK("status" IN ('running', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `user_backups_owner_idx` ON `user_backups` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_restores` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`mode` text,
	`filename` text,
	`backup_id` text,
	`pre_backup_id` text,
	`undo_of` text,
	`preview` text,
	`progress_done` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_restores_status_check" CHECK("status" IN ('validating', 'ready', 'restoring', 'succeeded', 'failed', 'undone', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `user_restores_owner_idx` ON `user_restores` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `backup_frequency` text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `backup_keep` integer DEFAULT 4 NOT NULL;