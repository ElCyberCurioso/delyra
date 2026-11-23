ALTER TABLE `board_columns` ADD `delegated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `kind` text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `assignee` text;