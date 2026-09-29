CREATE TABLE `db_arcs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`saga_id` integer NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_ja` text,
	`order_idx` integer NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_arcs_slug_unique` ON `db_arcs` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_db_arcs_saga` ON `db_arcs` (`saga_id`);--> statement-breakpoint
CREATE TABLE `db_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`source_id` text NOT NULL,
	`source_url` text,
	`license_key` text NOT NULL,
	`attribution` text,
	`sha256` text,
	`mime_type` text,
	`bytes` integer,
	`width` integer,
	`height` integer,
	`entity_type` text,
	`entity_id` integer,
	`role` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `db_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_assets_path_unique` ON `db_assets` (`path`);--> statement-breakpoint
CREATE INDEX `idx_db_assets_entity` ON `db_assets` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_db_assets_source` ON `db_assets` (`source_id`);--> statement-breakpoint
CREATE TABLE `db_character_techniques` (
	`character_id` integer NOT NULL,
	`technique_id` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_db_char_tech_char` ON `db_character_techniques` (`character_id`);--> statement-breakpoint
CREATE INDEX `idx_db_char_tech_tech` ON `db_character_techniques` (`technique_id`);--> statement-breakpoint
CREATE TABLE `db_episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series` text NOT NULL,
	`number_in_series` integer NOT NULL,
	`title` text NOT NULL,
	`title_ja` text,
	`title_romaji` text,
	`arc_id` integer,
	`air_date` integer,
	`duration_sec` integer,
	`synopsis` text,
	`image` text,
	`mal_id` integer
);
--> statement-breakpoint
CREATE INDEX `idx_db_episodes_series_num` ON `db_episodes` (`series`,`number_in_series`);--> statement-breakpoint
CREATE INDEX `idx_db_episodes_arc` ON `db_episodes` (`arc_id`);--> statement-breakpoint
CREATE TABLE `db_game_characters` (
	`game_id` integer NOT NULL,
	`character_id` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_db_gc_game` ON `db_game_characters` (`game_id`);--> statement-breakpoint
CREATE INDEX `idx_db_gc_char` ON `db_game_characters` (`character_id`);--> statement-breakpoint
CREATE TABLE `db_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`title_ja` text,
	`platforms` text,
	`release_date` integer,
	`publisher` text DEFAULT 'Bandai Namco Entertainment',
	`developer` text,
	`description` text,
	`cover` text,
	`official_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_games_slug_unique` ON `db_games` (`slug`);--> statement-breakpoint
CREATE TABLE `db_licenses` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`requires_attribution` integer DEFAULT true NOT NULL,
	`share_alike` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `db_manga_chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`title` text,
	`title_ja` text,
	`volume_id` integer,
	`published_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_db_manga_chap` ON `db_manga_chapters` (`series`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `idx_db_manga_chap_vol` ON `db_manga_chapters` (`volume_id`);--> statement-breakpoint
CREATE TABLE `db_manga_volumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series` text NOT NULL,
	`volume_number` integer NOT NULL,
	`title` text,
	`title_ja` text,
	`published_at` integer,
	`cover` text,
	`isbn` text
);
--> statement-breakpoint
CREATE INDEX `idx_db_manga_vol` ON `db_manga_volumes` (`series`,`volume_number`);--> statement-breakpoint
CREATE TABLE `db_movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`title_ja` text,
	`title_romaji` text,
	`series` text NOT NULL,
	`release_date` integer,
	`duration_min` integer,
	`synopsis` text,
	`poster` text,
	`mal_id` integer,
	`anilist_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_movies_slug_unique` ON `db_movies` (`slug`);--> statement-breakpoint
CREATE TABLE `db_news` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_url` text NOT NULL,
	`title` text NOT NULL,
	`title_ja` text,
	`excerpt` text,
	`category` text,
	`published_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_news_source_url_unique` ON `db_news` (`source_url`);--> statement-breakpoint
CREATE INDEX `idx_db_news_published` ON `db_news` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_db_news_source` ON `db_news` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_db_news_category` ON `db_news` (`category`);--> statement-breakpoint
CREATE TABLE `db_races` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_ja` text,
	`home_planet_id` integer,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_races_slug_unique` ON `db_races` (`slug`);--> statement-breakpoint
CREATE TABLE `db_sagas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_ja` text,
	`series` text NOT NULL,
	`order_idx` integer NOT NULL,
	`description` text,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_sagas_slug_unique` ON `db_sagas` (`slug`);--> statement-breakpoint
CREATE TABLE `db_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`license_key` text NOT NULL,
	`attribution_template` text
);
--> statement-breakpoint
CREATE TABLE `db_techniques` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_ja` text,
	`name_romaji` text,
	`type` text,
	`creator_id` integer,
	`description` text,
	`debut_episode_id` integer,
	`debut_chapter_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_techniques_slug_unique` ON `db_techniques` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_db_techniques_creator` ON `db_techniques` (`creator_id`);
-- FTS5 virtual table cross-entity (chars + planets + transformations + techniques + sagas + arcs + episodes + movies + games)
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS db_search USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  name,
  name_ja,
  description,
  tokenize = 'unicode61 remove_diacritics 2'
);
