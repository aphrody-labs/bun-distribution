CREATE TABLE `dm_contacts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`allowed` integer DEFAULT false NOT NULL,
	`note` text,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dm_contacts_allowed` ON `dm_contacts` (`allowed`);--> statement-breakpoint
CREATE TABLE `dm_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`direction` text NOT NULL,
	`content` text NOT NULL,
	`persona` text DEFAULT 'shenron' NOT NULL,
	`message_id` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dm_messages_user` ON `dm_messages` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_dm_messages_unread` ON `dm_messages` (`direction`,`read_at`);--> statement-breakpoint
CREATE INDEX `idx_dm_messages_created` ON `dm_messages` (`created_at`);
