CREATE TABLE `schema_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`r2_key` text,
	`size_bytes` integer,
	`error` text,
	CONSTRAINT "system_backup_runs_status_check" CHECK("status" IN ('running', 'succeeded', 'failed')),
	CONSTRAINT "system_backup_runs_trigger_check" CHECK("trigger" IN ('schedule', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `system_backup_runs_started_at_idx` ON `system_backup_runs` (`started_at`);