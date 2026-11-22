CREATE TABLE `board_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "board_invitations_role_check" CHECK("role" IN ('editor', 'reader'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_invitations_board_email_idx` ON `board_invitations` (`board_id`,`email`);--> statement-breakpoint
CREATE INDEX `board_invitations_email_idx` ON `board_invitations` (`email`);--> statement-breakpoint
CREATE TABLE `board_members` (
	`board_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`board_id`, `user_id`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "board_members_role_check" CHECK("role" IN ('editor', 'reader'))
);
--> statement-breakpoint
CREATE INDEX `board_members_user_idx` ON `board_members` (`user_id`);--> statement-breakpoint
ALTER TABLE `card_activity` ADD `actor_id` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `card_comments` ADD `author_id` text REFERENCES users(id) ON DELETE set null;