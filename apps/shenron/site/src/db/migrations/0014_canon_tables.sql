-- Canon : le corpus de preuves quitte le blob JSON de "CanonConfig" pour des
-- tables réelles, alimentées en continu par `apps/site/scripts/canon-ingest.ts`
-- (service `shenron-canon-ingest.service`) et lues par /api/canon, le MCP et
-- la page /wiki/canon.
--
-- `IF NOT EXISTS` → ré-exécutable sur la base de prod (drizzle-kit migrate
-- plante sous Bun ; on applique ce SQL directement).

CREATE TABLE IF NOT EXISTS "canon_references" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"keywords" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"text" text NOT NULL,
	"text_fr" text,
	"source" text NOT NULL,
	"year" integer,
	"document" text NOT NULL,
	"lang" text NOT NULL DEFAULT 'fr',
	"provenance" text NOT NULL DEFAULT 'manuel',
	"href" text,
	"hash" text NOT NULL,
	"visible" boolean NOT NULL DEFAULT true,
	"seen_at" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"created_at" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "canon_references_provenance_idx" ON "canon_references" ("provenance");
CREATE INDEX IF NOT EXISTS "canon_references_visible_idx" ON "canon_references" ("subject") WHERE "visible";
CREATE INDEX IF NOT EXISTS "canon_references_keywords_idx" ON "canon_references" USING gin ("keywords");

-- Les questions posées et le verdict rendu : la mémoire de l'arbitre.
CREATE TABLE IF NOT EXISTS "canon_verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"tier" text NOT NULL,
	"score" integer NOT NULL,
	"origine" text NOT NULL,
	"asked_count" integer NOT NULL DEFAULT 1,
	"first_asked_at" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"last_asked_at" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "canon_verdicts_last_idx" ON "canon_verdicts" ("last_asked_at" DESC);

-- Journal du service d'ingestion.
CREATE TABLE IF NOT EXISTS "canon_ingest_runs" (
	"id" bigserial PRIMARY KEY,
	"source" text NOT NULL,
	"started_at" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"finished_at" timestamp (3),
	"inserted" integer NOT NULL DEFAULT 0,
	"updated" integer NOT NULL DEFAULT 0,
	"unchanged" integer NOT NULL DEFAULT 0,
	"hidden" integer NOT NULL DEFAULT 0,
	"error" text
);
CREATE INDEX IF NOT EXISTS "canon_ingest_runs_started_idx" ON "canon_ingest_runs" ("started_at" DESC);
