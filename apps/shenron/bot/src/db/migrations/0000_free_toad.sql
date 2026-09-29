CREATE TABLE `achievement_triggers` (
	`code` text PRIMARY KEY NOT NULL,
	`description` text,
	`pattern` text NOT NULL,
	`flags` text DEFAULT 'i',
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `achievements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`unlocked_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_achievement_user_code` ON `achievements` (`user_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_achievement_user` ON `achievements` (`user_id`);--> statement-breakpoint
CREATE TABLE `action_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`moderator_id` text,
	`action` text NOT NULL,
	`reason` text,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_log_user` ON `action_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_log_action` ON `action_logs` (`action`);--> statement-breakpoint
CREATE INDEX `idx_log_created` ON `action_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `db_characters` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image` text NOT NULL,
	`ki` text,
	`max_ki` text,
	`race` text,
	`gender` text,
	`affiliation` text,
	`description` text,
	`origin_planet_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_characters_name_unique` ON `db_characters` (`name`);--> statement-breakpoint
CREATE INDEX `idx_db_char_race` ON `db_characters` (`race`);--> statement-breakpoint
CREATE INDEX `idx_db_char_affiliation` ON `db_characters` (`affiliation`);--> statement-breakpoint
CREATE TABLE `db_planets` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image` text NOT NULL,
	`is_destroyed` integer DEFAULT false NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_planets_name_unique` ON `db_planets` (`name`);--> statement-breakpoint
CREATE TABLE `db_transformations` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image` text NOT NULL,
	`ki` text,
	`character_id` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_db_transfo_char` ON `db_transformations` (`character_id`);--> statement-breakpoint
CREATE TABLE `fusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_a` text NOT NULL,
	`user_b` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fusion_pair` ON `fusions` (`user_a`,`user_b`);--> statement-breakpoint
CREATE INDEX `idx_fusion_user_a` ON `fusions` (`user_a`);--> statement-breakpoint
CREATE INDEX `idx_fusion_user_b` ON `fusions` (`user_b`);--> statement-breakpoint
CREATE TABLE `giveaway_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`giveaway_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`entered_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`giveaway_id`) REFERENCES `giveaways`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_giveaway_entry` ON `giveaway_entries` (`giveaway_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `giveaways` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`host_id` text NOT NULL,
	`title` text NOT NULL,
	`reward` text NOT NULL,
	`description` text,
	`winners` integer DEFAULT 1 NOT NULL,
	`ends_at` integer NOT NULL,
	`ended` integer DEFAULT false NOT NULL,
	`winner_ids` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `giveaways_message_id_unique` ON `giveaways` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_giveaway_ends` ON `giveaways` (`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_giveaway_ended` ON `giveaways` (`ended`);--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_key` text NOT NULL,
	`acquired_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_inventory_user_item` ON `inventory` (`user_id`,`item_type`,`item_key`);--> statement-breakpoint
CREATE INDEX `idx_inventory_user` ON `inventory` (`user_id`);--> statement-breakpoint
CREATE TABLE `jails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`reason` text,
	`expires_at` integer,
	`released_at` integer,
	`previous_roles` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jails_user` ON `jails` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_jails_expires` ON `jails` (`expires_at`);--> statement-breakpoint
CREATE TABLE `level_rewards` (
	`level` integer PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`zeni_bonus` integer DEFAULT 1000 NOT NULL,
	`xp_threshold` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shop_items` (
	`key` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`role_id` text,
	`meta` text,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_shop_type` ON `shop_items` (`type`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`context` text,
	`closed` integer DEFAULT false NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_channel_id_unique` ON `tickets` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_tickets_owner` ON `tickets` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_tickets_closed` ON `tickets` (`closed`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`zeni` integer DEFAULT 1000 NOT NULL,
	`current_level_role_id` text,
	`last_level_reached` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`last_voice_join_at` integer,
	`total_voice_ms` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_daily_quest_at` integer,
	`daily_streak` integer DEFAULT 0 NOT NULL,
	`equipped_card` text,
	`equipped_badge` text,
	`equipped_color` text,
	`equipped_title` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_users_xp` ON `users` (`xp`);--> statement-breakpoint
CREATE INDEX `idx_users_zeni` ON `users` (`zeni`);--> statement-breakpoint
CREATE TABLE `vocal_tempo` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vocal_owner` ON `vocal_tempo` (`owner_id`);--> statement-breakpoint
CREATE TABLE `vocal_tempo_bans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`banned_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_voctempo_ban` ON `vocal_tempo_bans` (`owner_id`,`banned_user_id`);--> statement-breakpoint
CREATE TABLE `warns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`reason` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_warns_user` ON `warns` (`user_id`);