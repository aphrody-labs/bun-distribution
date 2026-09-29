-- Index analytics sur site_events (dashboard « Activité du site ») + rattrapage
-- de snapshot pour HomeConfig / SiteTheme (créées historiquement via `push`,
-- absentes des migrations versionnées).
--
-- Tout est `IF NOT EXISTS` → ré-exécutable et sûr sur la base de prod existante
-- (sur ce Postgres, `drizzle-kit migrate` plante sous Bun → l'application réelle
-- passe par `drizzle-kit push` ; ce fichier reste l'artefact versionné idempotent).

CREATE TABLE IF NOT EXISTS "HomeConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updatedBy" text,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "SiteTheme" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updatedBy" text,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_path_idx" ON "site_events" USING btree ("path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_referrer_idx" ON "site_events" USING btree ("referrer");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_session_idx" ON "site_events" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_ts_idx" ON "site_events" USING btree ("ts");
