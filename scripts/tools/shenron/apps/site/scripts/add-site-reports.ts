/**
 * Crée la table `public.site_reports` (signalements/tickets utilisateurs) sur le
 * Postgres du site. Idempotent (`CREATE TABLE IF NOT EXISTS`) — sûr à rejouer.
 *
 * Miroir de `siteReports` dans `apps/site/src/db/schema.ts`. Appliquée à la main
 * (le site utilise `db:push` historiquement ; `drizzle-kit migrate` plante sous
 * Bun). Lancer :
 *   DATABASE_URL=... bun apps/site/scripts/add-site-reports.ts
 * ou via l'EnvironmentFile systemd (cf. add-wiki-sections.ts).
 */
import postgres from "postgres";

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const sql = postgres(url, { max: 1 });
	try {
		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS public."site_reports" (
				id          text PRIMARY KEY,
				"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
				"userId"    text,
				"discordId" text,
				username    text,
				path        text NOT NULL,
				"pageTitle" text,
				category    text NOT NULL DEFAULT 'bug',
				message     text NOT NULL,
				"userAgent" text,
				status      text NOT NULL DEFAULT 'open',
				"adminNote" text,
				"resolvedBy" text,
				"resolvedAt" timestamp(3)
			)
		`);
		await sql.unsafe(
			`ALTER TABLE public."site_reports" ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true`
		);
		await sql.unsafe(
			`CREATE INDEX IF NOT EXISTS site_reports_status_idx ON public."site_reports" (status)`
		);
		await sql.unsafe(
			`CREATE INDEX IF NOT EXISTS site_reports_created_idx ON public."site_reports" ("createdAt")`
		);
		await sql.unsafe(
			`CREATE INDEX IF NOT EXISTS site_reports_user_idx ON public."site_reports" ("userId")`
		);
		console.log("✓ public.site_reports (+ index status/created/user)");
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
