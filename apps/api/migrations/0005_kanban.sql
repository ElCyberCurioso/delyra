CREATE TABLE `board_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`wip_limit` integer,
	`is_done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `board_columns_board_idx` ON `board_columns` (`board_id`,`position`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`template` text DEFAULT 'empty' NOT NULL,
	`autoarchive_days` integer DEFAULT 14 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "boards_template_check" CHECK("template" IN ('personal', 'sprint', 'audit', 'empty'))
);
--> statement-breakpoint
CREATE INDEX `boards_owner_idx` ON `boards` (`owner_id`);--> statement-breakpoint
CREATE TABLE `card_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_activity_card_idx` ON `card_activity` (`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `card_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_attachments_card_idx` ON `card_attachments` (`card_id`);--> statement-breakpoint
CREATE TABLE `card_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_comments_card_idx` ON `card_comments` (`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `card_labels` (
	`card_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `label_id`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_labels_label_idx` ON `card_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`board_id` text NOT NULL,
	`column_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` text NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`due_at` integer,
	`due_all_day` integer DEFAULT false NOT NULL,
	`due_tz` text,
	`completed_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `board_columns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cards_priority_check" CHECK("priority" IN ('none', 'low', 'medium', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE INDEX `cards_column_idx` ON `cards` (`column_id`,`position`);--> statement-breakpoint
CREATE INDEX `cards_owner_due_idx` ON `cards` (`owner_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `cards_board_idx` ON `cards` (`board_id`);--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`card_id` text NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`position` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklist_items_card_idx` ON `checklist_items` (`card_id`,`position`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `labels_board_idx` ON `labels` (`board_id`);