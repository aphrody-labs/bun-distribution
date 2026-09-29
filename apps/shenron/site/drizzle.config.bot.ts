import { defineConfig } from "drizzle-kit";

/**
 * Config Drizzle dédiée au schéma **`bot`** (wiki mirroité), distinct du
 * `drizzle.config.ts` (schéma `public`, tables site/auth/télémétrie).
 *
 * Sert à matérialiser les tables `bot.*` dans le PostgreSQL local du VPS
 * (migration Neon → PG local, 2026-06-23) à partir du schéma lecture du site
 * `src/db/bot-schema.ts` — y compris les colonnes Neon-only (`players`,
 * `subtitles`, `frames`, `pages`, `stream_*`) absentes du SQLite du bot.
 *
 * `schemaFilter: ["bot"]` BORNE l'introspection/diff au seul schéma `bot` →
 * jamais de touch sur `public.*` (sécurité : un push non borné voudrait droper
 * les tables public inconnues de ce schéma).
 *
 * Garde : `push` et `migrate` sont refusés (generate-only), avant toute connexion.
 *
 * Le seed des données vient ensuite de `apps/shenron/bot/scripts/seed-pg-from-sqlite.ts`.
 */
const REFUSED_COMMANDS = ["push", "migrate"] as const;
const refused = process.argv.find((arg) => (REFUSED_COMMANDS as readonly string[]).includes(arg));
if (refused) {
	// Refus AVANT toute lecture d'URL ou connexion : le schéma `bot` est
	// generate-only, PostgreSQL est appliqué par le pipeline aphrody-infra.
	throw new Error(
		`drizzle.config.bot.ts : « drizzle-kit ${refused} » refusé — le schéma bot est generate-only. ` +
			"Les migrations PostgreSQL passent par le runbook aphrody-infra (docs/INFRA-DELEGATION.md)."
	);
}

export default defineConfig({
	schema: "./src/db/bot-schema.ts",
	out: "./drizzle-bot",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	schemaFilter: ["bot"],
	verbose: true,
	strict: true,
});
