CREATE TABLE IF NOT EXISTS `narrative_timelines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`parent_id` integer REFERENCES `narrative_timelines`(`id`),
	`source_id` text,
	`visible` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `narrative_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`title_ja` text,
	`title_romaji` text,
	`synopsis_fr` text,
	`timeline_id` integer NOT NULL REFERENCES `narrative_timelines`(`id`),
	`saga_id` integer,
	`arc_id` integer,
	`canon` text NOT NULL DEFAULT 'unverified',
	`start_order` real,
	`end_order` real,
	`source_id` text,
	`visible` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `narrative_event_aliases` (
	`event_id` integer NOT NULL REFERENCES `narrative_events`(`id`),
	`alias` text NOT NULL,
	`locale` text NOT NULL DEFAULT 'fr',
	PRIMARY KEY (`event_id`, `alias`, `locale`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `narrative_event_participants` (
	`event_id` integer NOT NULL REFERENCES `narrative_events`(`id`),
	`character_id` integer NOT NULL,
	`role` text NOT NULL DEFAULT 'participant',
	`outcome` text,
	PRIMARY KEY (`event_id`, `character_id`, `role`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `narrative_event_relations` (
	`from_event_id` integer NOT NULL REFERENCES `narrative_events`(`id`),
	`to_event_id` integer NOT NULL REFERENCES `narrative_events`(`id`),
	`relation` text NOT NULL,
	PRIMARY KEY (`from_event_id`, `to_event_id`, `relation`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `contributors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`name_ja` text,
	`name_romaji` text,
	`category` text NOT NULL,
	`birth_date` text,
	`death_date` text,
	`biography_fr` text,
	`spotlight_rank` integer,
	`source_id` text,
	`visible` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `contributor_credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contributor_id` integer NOT NULL REFERENCES `contributors`(`id`),
	`role` text NOT NULL,
	`credit_scope` text NOT NULL,
	`work_id` integer,
	`episode_id` integer,
	`movie_id` integer,
	`game_id` integer,
	`soundtrack_id` integer,
	`character_id` integer,
	`source_id` text,
	`visible` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_narrative_events_timeline` ON `narrative_events` (`timeline_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_narrative_events_saga` ON `narrative_events` (`saga_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_narrative_events_arc` ON `narrative_events` (`arc_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_narrative_events_canon` ON `narrative_events` (`canon`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_narrative_participants_char` ON `narrative_event_participants` (`character_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_narrative_relations_to` ON `narrative_event_relations` (`to_event_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_contributors_category` ON `contributors` (`category`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_contributors_spotlight` ON `contributors` (`spotlight_rank`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_contributor_credits_contributor` ON `contributor_credits` (`contributor_id`);
