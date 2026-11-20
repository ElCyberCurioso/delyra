CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_id` text,
	`event` text NOT NULL,
	`country` text,
	`user_agent` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_user_idx` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`key_hash` text NOT NULL,
	`success` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_lookup_idx` ON `auth_attempts` (`scope`,`key_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invitations_role_check" CHECK("role" IN ('admin', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_idx` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_idx` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_resets_user_idx` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_codes_user_idx` ON `recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`user_agent` text,
	`country` text,
	`revoked_at` integer,
	`revoked_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_state_check" CHECK("state" IN ('pending_2fa', 'pending_totp', 'active'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_idx` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`time_zone` text DEFAULT 'Europe/Madrid' NOT NULL,
	`locale` text DEFAULT 'es' NOT NULL,
	`week_start` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_totp` (
	`user_id` text PRIMARY KEY NOT NULL,
	`secret_enc` text NOT NULL,
	`confirmed_at` integer,
	`last_used_counter` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer,
	`password_changed_at` integer,
	CONSTRAINT "users_role_check" CHECK("role" IN ('admin', 'member')),
	CONSTRAINT "users_status_check" CHECK("status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);