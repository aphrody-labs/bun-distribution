/**
 * Tests OFFLINE du snapshot Supabase — contrat de données consommé par le web Angular.
 *
 * Pendant local/déterministe de `supabase-rls.test.ts` (qui, lui, tape le réseau) :
 * ici on valide la *forme* et la *cohérence* des données réelles extraites en SQLite,
 * sans réseau ni credentials. Skip automatique si le snapshot est absent.
 *
 * Run : bun test tests/supabase/snapshot.test.ts
 */
import { expect, test } from "bun:test";

import { describeWithSnapshot } from "../fixtures/snapshot";

describeWithSnapshot("Snapshot — surface de lecture web (vues)", (db) => {
	test("user_view : projection curatée (id Discord, displayName, elo solo)", () => {
		const rows = db()
			.query("SELECT id, displayName, solo_elo, isBlacklisted FROM user_view LIMIT 50")
			.all() as Array<{ id: string; displayName: string; solo_elo: number | null }>;
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(typeof r.id).toBe("string");
			expect(r.id).toMatch(/^\d{17,19}$/);
		}
	});

	test("leaderboard_view : rang min = 1, rang non décroissant et elo non croissant par mode", () => {
		// `mode` est l'enum GameMode (entier). On itère sur les modes réellement présents.
		const modes = (
			db().query("SELECT DISTINCT mode FROM leaderboard_view ORDER BY mode").all() as Array<{
				mode: number;
			}>
		).map((r) => r.mode);
		expect(modes.length).toBeGreaterThan(0);

		for (const mode of modes) {
			const rows = db()
				.query("SELECT elo, rank FROM leaderboard_view WHERE mode = ? ORDER BY rank")
				.all(mode) as Array<{ elo: number; rank: number }>;
			expect(rows.length).toBeGreaterThan(0);
			expect(rows[0].rank).toBe(1); // RANK() fenêtré : commence à 1 (égalités possibles)
			for (let i = 1; i < rows.length; i++) {
				expect(rows[i].rank).toBeGreaterThanOrEqual(rows[i - 1].rank);
				expect(rows[i].elo).toBeLessThanOrEqual(rows[i - 1].elo);
			}
		}
	});

	test("tier_view : couverture continue des paliers (maxElo+1 == minElo suivant)", () => {
		const rows = db()
			.query("SELECT key, minElo, maxElo FROM tier_view ORDER BY minElo")
			.all() as Array<{ key: string; minElo: number; maxElo: number }>;
		expect(rows.length).toBe(11);
		for (let i = 1; i < rows.length; i++) {
			expect(rows[i].minElo).toBe(rows[i - 1].maxElo + 1);
		}
	});

	test("clan_list_view : présente et alignée sur le nombre de clans", () => {
		const clans = (db().query("SELECT count(*) AS n FROM clan").get() as { n: number }).n;
		const view = (db().query("SELECT count(*) AS n FROM clan_list_view").get() as { n: number }).n;
		expect(view).toBe(clans);
	});

	test("homepage_stat_view : statistiques numériques exposées", () => {
		const rows = db().query("SELECT * FROM homepage_stat_view").all() as Array<
			Record<string, unknown>
		>;
		expect(rows.length).toBeGreaterThan(0);
	});
});

describeWithSnapshot("Snapshot — secrets jamais extraits", (db) => {
	test("user_connection ne contient AUCUNE colonne de token (masque du dump + RLS)", () => {
		const cols = (
			db().query("PRAGMA table_info(user_connection)").all() as Array<{ name: string }>
		).map((c) => c.name);
		expect(cols).not.toContain("access_token");
		expect(cols).not.toContain("refresh_token");
		// colonnes sûres bien présentes
		expect(cols).toContain("provider");
		expect(cols).toContain("external_username");
	});

	test("aucune relation du snapshot n'expose une colonne *_token / secret", () => {
		const tables = (
			db().query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
				name: string;
			}>
		).map((t) => t.name);
		const forbidden = /(access_token|refresh_token|secret|password)/i;
		const leaks: string[] = [];
		for (const t of tables) {
			const cols = (db().query(`PRAGMA table_info("${t}")`).all() as Array<{ name: string }>).map(
				(c) => c.name
			);
			for (const c of cols) if (forbidden.test(c)) leaks.push(`${t}.${c}`);
		}
		expect(leaks).toEqual([]);
	});
});
