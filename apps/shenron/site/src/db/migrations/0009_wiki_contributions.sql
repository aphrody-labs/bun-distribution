-- Contributions communautaires au wiki.
--
-- Jusqu'ici un membre ne pouvait que déposer un ticket en texte libre
-- (`site_reports`) : la correction restait à faire à la main par un admin, qui
-- devait retrouver la fiche, le champ, et la formulation voulue. Cette table
-- porte la proposition elle-même — (table, ligne, colonne) + la valeur de
-- remplacement + ses sources — de sorte qu'accepter tient en un clic et que
-- l'écriture reste le chemin unique déjà éprouvé (`updateWiki` + révision).
--
-- `valueBefore` n'est pas décoratif : c'est la base du diff affiché au
-- modérateur ET le détecteur de conflit. Si la valeur en base a changé depuis
-- la proposition, l'appliquer écraserait le travail de quelqu'un d'autre — la
-- contribution passe alors en `superseded` au lieu d'être appliquée.
--
-- `IF NOT EXISTS` → ré-exécutable et sûr sur la base de prod (sur ce Postgres,
-- `drizzle-kit migrate` plante sous Bun → l'application réelle passe par `push`
-- ou l'exécution directe de ce SQL ; ce fichier reste l'artefact versionné).

CREATE TABLE IF NOT EXISTS "wiki_contributions" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"authorId" text,
	"authorName" text,
	"authorDiscordId" text,
	"tableName" text NOT NULL,
	"rowId" text NOT NULL,
	"columnName" text NOT NULL,
	"entityLabel" text,
	"entityPath" text,
	"valueBefore" text,
	"valueAfter" text NOT NULL,
	"comment" text,
	"sources" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewerId" text,
	"reviewerName" text,
	"reviewNote" text,
	"reviewedAt" timestamp (3),
	"revisionId" text
);

CREATE INDEX IF NOT EXISTS "wiki_contributions_status_idx"
	ON "wiki_contributions" USING btree ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "wiki_contributions_entity_idx"
	ON "wiki_contributions" USING btree ("tableName", "rowId");
CREATE INDEX IF NOT EXISTS "wiki_contributions_author_idx"
	ON "wiki_contributions" USING btree ("authorId", "createdAt");
