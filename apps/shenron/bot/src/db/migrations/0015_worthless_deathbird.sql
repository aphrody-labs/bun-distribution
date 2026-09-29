CREATE TABLE `race_level_roles` (
	`race` text NOT NULL,
	`level` integer NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`race`, `level`)
);
