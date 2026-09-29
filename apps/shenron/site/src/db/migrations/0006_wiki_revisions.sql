-- Historique des révisions du wiki éditorial (versioning CMS). Chaque écriture
-- passant par /api/wiki-admin (create/update/delete + bascule de visibilité)
-- laisse ici un snapshot avant/après borné aux colonnes mutables + l'auteur figé.
-- Alimente /admin/wiki/history, le panneau historique du studio et le retour
-- arrière (restauration du snapshot `before`).
--
-- `IF NOT EXISTS` → ré-exécutable et sûr sur la base de prod (sur ce Postgres,
-- `drizzle-kit migrate` plante sous Bun → l'application réelle passe par `push`
-- ou l'exécution directe de ce SQL ; ce fichier reste l'artefact versionné).

CREATE TABLE IF NOT EXISTS "wiki_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tableName" text NOT NULL,
	"rowId" text NOT NULL,
	"action" text NOT NULL,
	"label" text,
	"before" jsonb,
	"after" jsonb,
	"editorId" text,
	"editorName" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_revisions_entity_idx" ON "wiki_revisions" ("tableName","rowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_revisions_created_idx" ON "wiki_revisions" ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_revisions_editor_idx" ON "wiki_revisions" ("editorId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_revisions_action_idx" ON "wiki_revisions" ("action");
