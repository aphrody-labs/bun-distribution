/**
 * Setup préchargé pour tous les tests Bun (`bunfig.toml::test.preload`).
 *
 * Supabase-first + Bun-natif : pas de Postgres local, pas de driver SQLite MikroORM
 * (better-sqlite3 n'est pas supporté sous Bun). Les tests de données s'appuient sur :
 *   - le snapshot SQLite local via `bun:sqlite` (tests/fixtures/snapshot.ts) — offline,
 *   - l'API PostgREST Supabase réelle (tests/supabase/supabase-rls.test.ts) — réseau.
 *
 * Ce fichier n'expose plus que les globals d'infrastructure (URLs / DB url optionnelle)
 * et `reflect-metadata` (décorateurs).
 */

import "reflect-metadata";

// Env de test
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.BOT_PROFILE = process.env.BOT_PROFILE ?? "current";
process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? "test-bot-token";
process.env.DEV_BOT_TOKEN = process.env.DEV_BOT_TOKEN ?? "test-dev-bot-token";
process.env.TEST_GUILD_ID = process.env.TEST_GUILD_ID ?? "100000000000000000";
process.env.BOT_OWNER_ID = process.env.BOT_OWNER_ID ?? "100000000000000001";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "test-client-id";
process.env.DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "test-client-secret";
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY ?? "test-only-jwt-secret";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/achillea_test";

// ---------------------------------------------------------------------------
// Globals infrastructure (E2E / intégration optionnelle)
// ---------------------------------------------------------------------------

declare global {
	var TEST_BASE_URL: string;
	var TEST_DB_URL: string;
	var TEST_SOCKET_URL: string;
}

globalThis.TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:4200";
// Supabase-first : pas de Postgres local. Optionnel — pointer une branche Supabase de test
// (ex. postgresql://postgres:<pwd>@db.<branch-ref>.supabase.co:5432/postgres?sslmode=require).
globalThis.TEST_DB_URL = process.env.TEST_DB_URL ?? "";
globalThis.TEST_SOCKET_URL = process.env.TEST_SOCKET_URL ?? "http://127.0.0.1:4011";
