CREATE TABLE `db_media_publications` (
	`id` integer PRIMARY KEY NOT NULL,
	`legacy_databook_id` integer NOT NULL UNIQUE,
	`publication_type` text NOT NULL,
	`title` text NOT NULL,
	`title_ja` text,
	`author` text,
	`illustrator` text,
	`published_at` integer,
	`cover` text,
	`description` text,
	`pages` text,
	`visible` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX `idx_db_media_publications_type_date`
	ON `db_media_publications` (`publication_type`, `published_at`);
