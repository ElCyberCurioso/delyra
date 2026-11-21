ALTER TABLE `user_totp` ADD `pending_secret_enc` text;--> statement-breakpoint
ALTER TABLE `user_totp` ADD `pending_created_at` integer;