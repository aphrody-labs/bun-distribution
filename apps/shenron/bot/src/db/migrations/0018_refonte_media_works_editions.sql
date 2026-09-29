CREATE TABLE IF NOT EXISTS `media_works` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`kind` text NOT NULL,
	`series` text NOT NULL,
	`title` text NOT NULL,
	`title_ja` text,
	`title_romaji` text,
	`synopsis_fr` text,
	`source_id` integer,
	`visible` integer NOT NULL DEFAULT 1,
	`created_at` integer NOT NULL DEFAULT (strftime('%s', 'now')),
	`updated_at` integer NOT NULL DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_editions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` integer NOT NULL REFERENCES `media_works`(`id`),
	`edition` text NOT NULL,
	`label` text NOT NULL,
	`language` text NOT NULL DEFAULT 'ja',
	`isbn` text,
	`publisher` text,
	`published_at` text,
	`page_color` text NOT NULL DEFAULT 'nb',
	`scan_policy` text NOT NULL DEFAULT 'self_hosted',
	`visible` integer NOT NULL DEFAULT 1,
	UNIQUE (`work_id`, `edition`, `language`, `isbn`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_volumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`edition_id` integer NOT NULL REFERENCES `media_editions`(`id`),
	`legacy_volume_id` integer UNIQUE,
	`number` real NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`title` text,
	`cover` text,
	`page_count` integer,
	`visible` integer NOT NULL DEFAULT 1,
	UNIQUE (`edition_id`, `number`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`volume_id` integer NOT NULL REFERENCES `media_volumes`(`id`),
	`legacy_chapter_id` integer UNIQUE,
	`number` real NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`title` text,
	`pages` text NOT NULL DEFAULT '[]',
	`ocr_status` text NOT NULL DEFAULT 'unprocessed',
	`visible` integer NOT NULL DEFAULT 1,
	UNIQUE (`volume_id`, `number`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_page_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uri` text NOT NULL,
	`width` integer,
	`height` integer,
	`sha256` text NOT NULL UNIQUE,
	`source_id` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_page_refs` (
	`chapter_id` integer NOT NULL REFERENCES `media_chapters`(`id`),
	`asset_id` integer NOT NULL REFERENCES `media_page_assets`(`id`),
	`ordinal` integer NOT NULL CHECK (`ordinal` > 0),
	`page_label` text,
	PRIMARY KEY (`chapter_id`, `ordinal`),
	UNIQUE (`chapter_id`, `asset_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_works_series` ON `media_works` (`series`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_editions_work` ON `media_editions` (`work_id`, `edition`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_volumes_edition` ON `media_volumes` (`edition_id`, `number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_chapters_volume` ON `media_chapters` (`volume_id`, `number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_media_page_refs_asset` ON `media_page_refs` (`asset_id`);
