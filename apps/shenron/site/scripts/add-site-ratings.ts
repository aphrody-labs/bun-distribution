/**
 * Crée la table `public.site_ratings` (notes 1–5 + commentaire optionnel) sur le
 * Postgres du site. Idempotent (`CREATE TABLE IF NOT EXISTS`) — sûr à rejouer.
 *
 * Miroir de `siteRatings` dans `apps/shenron/site/src/db/schema.ts`. Appliquée à la main
 * (le site utilise `db:push` historiquement ; `drizzle-kit migrate` plante sous
 * Bun). Lancer :
 *   DATABASE_URL=... bun apps/shenron/site/scripts/add-site-ratings.ts
 * ou via l'EnvironmentFile systemd / apps/shenron/site/.env.
 */
import postgres from "postgres";

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });
	try {
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS public."site_ratings" (
				id           text PRIMARY KEY,
				"targetType" text NOT NULL,
				"targetId"   text NOT NULL,
				"userId"     text NOT NULL,
				score        integer NOT NULL,
				comment      text,
				"createdAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);
		await sql.unsafe(`
			CREATE UNIQUE INDEX IF NOT EXISTS site_ratings_target_user_unique
			ON public."site_ratings" ("targetType", "targetId", "userId")
		`);
		await sql.unsafe(
			`CREATE INDEX IF NOT EXISTS site_ratings_target_idx ON public."site_ratings" ("targetType", "targetId")`
		);
		await sql.unsafe(
			`CREATE INDEX IF NOT EXISTS site_ratings_user_idx ON public."site_ratings" ("userId")`
		);
		await sql.unsafe(
			`CREATE INDEX IF NOT EXISTS site_ratings_created_idx ON public."site_ratings" ("createdAt")`
		);
		console.log("✓ public.site_ratings (+ index unique target/user + target/user/created)");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
