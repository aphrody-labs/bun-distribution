CREATE TABLE `command_permissions` (
	`name` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`allowed_roles` text DEFAULT '[]' NOT NULL,
	`denied_roles` text DEFAULT '[]' NOT NULL,
	`denied_users` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
