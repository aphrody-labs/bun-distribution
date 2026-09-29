-- Configuration singleton des bannières éditables depuis /admin/banners.
-- Idempotente : peut être appliquée sans risque sur une instance qui aurait
-- déjà reçu le schéma via `drizzle-kit push`.
CREATE TABLE IF NOT EXISTS "PageBanners" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updatedBy" text,
	"updatedAt" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
