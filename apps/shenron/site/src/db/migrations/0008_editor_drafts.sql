-- Brouillons du module d'édition (autosauvegarde).
--
-- Chaque éditeur du site (articles, wiki, sections CMS, home, champs d'admin)
-- pousse ici son état courant toutes les quelques secondes, sous une clé logique
-- stable (`post:<id>`, `wiki:<table>:<ligne>:<colonne>`…). Si l'onglet meurt, si
-- la session expire ou si l'enregistrement échoue, la reprise propose le
-- brouillon au lieu de laisser le texte partir en fumée. Un brouillon par
-- utilisateur : deux admins sur la même fiche ne s'écrasent pas.
--
-- `IF NOT EXISTS` → ré-exécutable et sûr sur la base de prod (sur ce Postgres,
-- `drizzle-kit migrate` plante sous Bun → l'application réelle passe par `push`
-- ou l'exécution directe de ce SQL ; ce fichier reste l'artefact versionné).

CREATE TABLE IF NOT EXISTS "editor_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"docKey" text NOT NULL,
	"userId" text NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"label" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "editor_drafts_doc_user_key" UNIQUE ("docKey", "userId")
);

CREATE INDEX IF NOT EXISTS "editor_drafts_user_idx"
	ON "editor_drafts" USING btree ("userId", "updatedAt");
