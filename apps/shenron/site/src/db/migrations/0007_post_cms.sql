-- CMS éditorial des articles ("Post") : éditeur riche, statuts de publication,
-- métadonnées SEO et tags.
--
-- Rétrocompatibilité stricte : `body` (Markdown historique) n'est PAS touché.
-- Un article dont `contentHtml` est NULL continue d'être rendu depuis `body`.
-- `published` reste la colonne de visibilité effective (sitemap, home, requêtes
-- publiques existantes) et est tenue synchrone avec le nouveau `status`.
--
-- `IF NOT EXISTS` → ré-exécutable et sûr sur la base de prod (sur ce Postgres,
-- `drizzle-kit migrate` plante sous Bun → l'application réelle passe par `push`
-- ou l'exécution directe de ce SQL ; ce fichier reste l'artefact versionné).

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "contentJson" jsonb;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "contentHtml" text;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "publishedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "coverAlt" text;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "coverCaption" text;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "seoTitle" text;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "seoDescription" text;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "ogImage" text;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "canonicalUrl" text;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "noindex" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "readingMinutes" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "wordCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Backfill des articles existants : un article déjà publié devient `published`
-- avec pour date de parution sa date de création (idempotent — ne retouche pas
-- une ligne déjà migrée).
UPDATE "Post"
   SET "status" = 'published',
       "publishedAt" = COALESCE("publishedAt", "createdAt")
 WHERE "published" = true AND "status" <> 'published';--> statement-breakpoint

UPDATE "Post"
   SET "status" = 'draft'
 WHERE "published" = false AND "status" NOT IN ('draft', 'scheduled');--> statement-breakpoint

-- Temps de lecture des articles historiques, estimé depuis le Markdown brut
-- (~220 mots/min, plancher à 1 min). Ne recalcule que les lignes non initialisées.
UPDATE "Post"
   SET "wordCount" = GREATEST(1, array_length(regexp_split_to_array(trim("body"), '\s+'), 1)),
       "readingMinutes" = GREATEST(
         1,
         ROUND(array_length(regexp_split_to_array(trim("body"), '\s+'), 1) / 220.0)::int
       )
 WHERE "wordCount" = 0 AND length(trim("body")) > 0;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "Post_published_publishedAt_idx" ON "Post" ("published","publishedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Post_status_idx" ON "Post" ("status");
