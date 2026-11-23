CREATE TABLE `microsoft_board_syncs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`board_id` text NOT NULL,
	`column_id` text NOT NULL,
	`only_teams` integer DEFAULT true NOT NULL,
	`days_ahead` integer DEFAULT 14 NOT NULL,
	`label_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer,
	`next_sync_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `microsoft_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `board_columns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "microsoft_board_syncs_status_check" CHECK("status" IN ('pending', 'ok', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_board_syncs_board_idx` ON `microsoft_board_syncs` (`board_id`);--> statement-breakpoint
CREATE INDEX `microsoft_board_syncs_owner_idx` ON `microsoft_board_syncs` (`owner_id`);--> statement-breakpoint
CREATE INDEX `microsoft_board_syncs_due_idx` ON `microsoft_board_syncs` (`next_sync_at`);--> statement-breakpoint
CREATE TABLE `microsoft_connections` (
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
	CONSTRAINT "microsoft_connections_status_check" CHECK("status" IN ('ok', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_connections_owner_idx` ON `microsoft_connections` (`owner_id`);--> statement-breakpoint
CREATE TABLE `microsoft_synced_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_id` text NOT NULL,
	`card_id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`start_at` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`description_hash` text NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`sync_id`) REFERENCES `microsoft_board_syncs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_synced_cards_card_idx` ON `microsoft_synced_cards` (`card_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_synced_cards_event_idx` ON `microsoft_synced_cards` (`sync_id`,`event_id`);