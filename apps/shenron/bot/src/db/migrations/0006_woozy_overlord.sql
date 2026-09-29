-- Ajout des noms multilingues sur le wiki Dragon Ball (enrichis depuis AniList).
-- Les ALTER TABLE pour `level_rewards.banner_url` et `users.equipped_banner` sont
-- omis ici : ces colonnes existent déjà en prod (schema drift non-tracké au
-- moment de leur ajout). Drizzle-kit les a re-générées mais elles ne doivent
-- pas être réappliquées.
ALTER TABLE `db_characters` ADD `name_ja` text;--> statement-breakpoint
ALTER TABLE `db_characters` ADD `name_romaji` text;--> statement-breakpoint
ALTER TABLE `db_planets` ADD `name_ja` text;--> statement-breakpoint
ALTER TABLE `db_planets` ADD `name_romaji` text;
