CREATE TABLE `db_manga_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series` text NOT NULL,
	`tome` text NOT NULL,
	`planche` integer NOT NULL,
	`lines` text NOT NULL,
	`text` text NOT NULL,
	`lang` text DEFAULT 'fr' NOT NULL,
	`has_ja` integer DEFAULT false NOT NULL,
	`line_count` integer DEFAULT 0 NOT NULL,
	`char_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_db_manga_pages` ON `db_manga_pages` (`series`,`tome`,`planche`);--> statement-breakpoint
CREATE INDEX `idx_db_manga_pages_series` ON `db_manga_pages` (`series`);