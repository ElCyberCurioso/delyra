CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendars_kind_check" CHECK("kind" IN ('personal', 'work', 'birthdays', 'custom'))
);
--> statement-breakpoint
CREATE INDEX `calendars_owner_idx` ON `calendars` (`owner_id`,`position`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`type` text DEFAULT 'event' NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`location` text,
	`url` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`tz` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`rrule` text,
	`exdates` text DEFAULT '[]' NOT NULL,
	`series_end_at` integer,
	`recurring_event_id` text,
	`original_start` integer,
	`birth_year` integer,
	`feb29_rule` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recurring_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "events_type_check" CHECK("type" IN ('event', 'birthday')),
	CONSTRAINT "events_range_check" CHECK("end_at" > "start_at")
);
--> statement-breakpoint
CREATE INDEX `events_owner_start_idx` ON `events` (`owner_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `events_calendar_idx` ON `events` (`calendar_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_override_idx` ON `events` (`recurring_event_id`,`original_start`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`offset_minutes` integer NOT NULL,
	`channel` text DEFAULT 'telegram' NOT NULL,
	`next_fire_at` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reminders_status_check" CHECK("status" IN ('scheduled', 'done'))
);
--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`status`,`next_fire_at`);--> statement-breakpoint
CREATE INDEX `reminders_target_idx` ON `reminders` (`target_type`,`target_id`);