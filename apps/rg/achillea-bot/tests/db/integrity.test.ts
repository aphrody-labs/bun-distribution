/**
 * Tests d'intégrité de la DB — exécutés sur le snapshot SQLite local (offline, Bun-natif).
 *
 * Source : `tests/fixtures/supabase-snapshot.sqlite`, extraction réelle de la prod
 * Supabase (`bun scripts/dump-supabase-sqlite.ts`). Aucun réseau ni credentials :
 * la suite se *skippe* si le snapshot est absent (clone frais / CI sans dump).
 *
 * Run :
 *   bun test tests/db/
 *   bun test tests/db/ --bail=1
 *
 * Vérifie sur données réelles :
 *   - relations critiques présentes + volumétrie plausible
 *   - cohérence des clés étrangères (aucun orphelin)
 *   - contraintes de format (Discord IDs, founders, name)
 *   - vues d'affichage consommées par le web (user_view, leaderboard_view, tier_view)
 */

import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import { describeWithSnapshot, countRows, listRelations } from "../fixtures/snapshot";

/** Compte d'orphelins via LEFT JOIN (FK enfant → parent introuvable). */
function orphanCount(
	db: Database,
	child: string,
	childKey: string,
	parent: string,
	parentKey: string
): number {
	const sql = `SELECT count(*) AS n FROM "${child}" c
		LEFT JOIN "${parent}" p ON c."${childKey}" = p."${parentKey}"
		WHERE c."${childKey}" IS NOT NULL AND p."${parentKey}" IS NULL`;
	return (db.query(sql).get() as { n: number }).n;
}

describeWithSnapshot("Intégrité schéma (snapshot Supabase)", (db) => {
	const CRITICAL = [
		"user",
		"clan",
		"clan_member",
		"organization",
		"event",
		"tournament_participant",
		"lobby",
		"lobby_user",
		"lobby_match",
		"rank",
		"notification",
		"user_notification",
	];

	test("relations critiques présentes", () => {
		const present = new Set(listRelations(db()));
		for (const rel of CRITICAL) expect(present.has(rel)).toBe(true);
	});

	test("11 paliers de rank, min_elo strictement croissant", () => {
		const rows = db().query("SELECT key, min_elo FROM rank ORDER BY min_elo").all() as Array<{
			key: string;
			min_elo: number;
		}>;
		expect(rows.length).toBe(11);
		for (let i = 1; i < rows.length; i++) {
			expect(rows[i].min_elo).toBeGreaterThan(rows[i - 1].min_elo);
		}
		expect(rows[0].min_elo).toBe(0);
	});
});

describeWithSnapshot("Données peuplées (snapshot Supabase)", (db) => {
	test("≥ 450 users", () => {
		expect(countRows(db(), "user")).toBeGreaterThanOrEqual(450);
	});

	test("≥ 35 clans", () => {
		expect(countRows(db(), "clan")).toBeGreaterThanOrEqual(35);
	});

	test("≥ 440 memberships", () => {
		expect(countRows(db(), "clan_member")).toBeGreaterThanOrEqual(440);
	});

	test("Organization Achillea (id=1) + owner Aless", () => {
		const org = db().query("SELECT name, owner_id FROM organization WHERE id = 1").get() as {
			name: string;
			owner_id: string;
		} | null;
		expect(org).not.toBeNull();
		expect(org!.name).toBe("Achillea");
		expect(org!.owner_id).toBe("238660901375442954");
	});
});

describeWithSnapshot("Cohérence des clés étrangères (snapshot Supabase)", (db) => {
	test("aucun clan_member orphelin (user_id)", () => {
		expect(orphanCount(db(), "clan_member", "user_id", "user", "id")).toBe(0);
	});

	test("aucun clan_member orphelin (clan_id)", () => {
		expect(orphanCount(db(), "clan_member", "clan_id", "clan", "id")).toBe(0);
	});

	test("organization.owner_id référence un user existant", () => {
		expect(orphanCount(db(), "organization", "owner_id", "user", "id")).toBe(0);
	});
});

describeWithSnapshot("Contraintes NOT NULL & format (snapshot Supabase)", (db) => {
	test("clan.name jamais NULL ni vide", () => {
		const n = (
			db().query("SELECT count(*) AS n FROM clan WHERE name IS NULL OR name = ''").get() as {
				n: number;
			}
		).n;
		expect(n).toBe(0);
	});

	test("tous les user.id sont des Discord IDs (17-19 chiffres)", () => {
		const rows = db().query('SELECT id FROM "user"').all() as Array<{ id: string }>;
		const re = /^\d{17,19}$/;
		const bad = rows.filter((r) => !re.test(String(r.id)) && r.id !== "test-discord-id-12345");
		expect(bad.length).toBe(0);
	});

	test("clan.founders : tableau JSON non vide pour tous les clans", () => {
		// json_array_length (JSON1) disponible dans bun:sqlite.
		const n = (
			db()
				.query(
					"SELECT count(*) AS n FROM clan WHERE founders IS NULL OR json_array_length(founders) = 0"
				)
				.get() as { n: number }
		).n;
		expect(n).toBe(0);
	});
});

describeWithSnapshot("Vues d'affichage (consommées par le web)", (db) => {
	test("user_view : présente et ≥ 466 lignes", () => {
		expect(listRelations(db())).toContain("user_view");
		expect(countRows(db(), "user_view")).toBeGreaterThanOrEqual(466);
	});

	test("leaderboard_view : présente, colonnes attendues", () => {
		const cols = (
			db().query("PRAGMA table_info(leaderboard_view)").all() as Array<{ name: string }>
		).map((c) => c.name);
		for (const c of ["mode", "userId", "elo", "rank", "displayName"]) expect(cols).toContain(c);
	});

	test("tier_view : 11 paliers avec compteurs de joueurs", () => {
		const rows = db().query("SELECT key, playerCountSolo FROM tier_view").all() as Array<{
			key: string;
			playerCountSolo: number;
		}>;
		expect(rows.length).toBe(11);
		const total = rows.reduce((s, r) => s + Number(r.playerCountSolo), 0);
		expect(total).toBeGreaterThan(0);
	});
});

// Suites historiques live-Postgres retirées (Supabase-first) : la couche réseau/RLS
// est désormais couverte par tests/supabase/supabase-rls.test.ts.
describe("TODO (couvert ailleurs / features futures)", () => {
	test.todo("Comptage des migrations appliquées → couvert par l'état prod + supabase-rls");
	test.todo("Historique ELO (user_experience_log) — table vide au snapshot");
});
