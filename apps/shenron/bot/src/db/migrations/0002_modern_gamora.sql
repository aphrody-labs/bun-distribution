CREATE TABLE `message_templates` (
	`event` text PRIMARY KEY NOT NULL,
	`template` text,
	`channel_key` text,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
