-- Doctrine de canonicité (/wiki/canon) : singleton JSON édité depuis
-- /admin/canon (définitions des rangs, règles générales, sujets tranchés).
--
-- `IF NOT EXISTS` → ré-exécutable et sûr sur la base de prod (sur ce Postgres,
-- `drizzle-kit migrate` plante sous Bun → l'application réelle passe par `push`
-- ou l'exécution directe de ce SQL ; ce fichier reste l'artefact versionné).

CREATE TABLE IF NOT EXISTS "CanonConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updatedBy" text,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
