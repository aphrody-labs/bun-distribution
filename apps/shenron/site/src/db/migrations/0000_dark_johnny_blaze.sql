-- Baseline télémétrie first-party (RGPD-safe).
--
-- Les 9 tables applicatives/auth pré-existantes (User, Post, Comment, Wiki*,
-- ba_*) ont été créées historiquement via `drizzle-kit push` (aucune migration
-- versionnée auparavant). Le snapshot `meta/0000_snapshot.json` les inclut comme
-- baseline pour les futurs `generate`, mais ce fichier SQL ne crée QUE les deux
-- nouvelles tables de télémétrie afin de pouvoir être appliqué tel quel sur la
-- base Neon existante sans collision. Tout est `IF NOT EXISTS` → ré-exécutable.

CREATE TABLE IF NOT EXISTS "site_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"type" text NOT NULL,
	"userId" text,
	"anonId" text NOT NULL,
	"sessionId" text NOT NULL,
	"entityType" text,
	"entityId" text,
	"path" text NOT NULL,
	"referrer" text,
	"visitorHash" text,
	"props" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"identity" text NOT NULL,
	"userId" text,
	"anonId" text,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eventCount" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_preferences_identity_unique" UNIQUE("identity")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_user_idx" ON "site_events" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_anon_idx" ON "site_events" USING btree ("anonId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_entity_idx" ON "site_events" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_events_type_ts_idx" ON "site_events" USING btree ("type","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_preferences_user_idx" ON "user_preferences" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_preferences_anon_idx" ON "user_preferences" USING btree ("anonId");
