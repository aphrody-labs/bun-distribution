CREATE TABLE `invites_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`inviter_id` text,
	`code` text,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_invites_inviter` ON `invites_log` (`inviter_id`);--> statement-breakpoint
CREATE INDEX `idx_invites_user` ON `invites_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_invites_joined` ON `invites_log` (`joined_at`);