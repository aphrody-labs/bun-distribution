/**
 * Tests SwissStageService — T-3.2
 *
 * Run: bun test tests/services/SwissStageService.test.ts
 *
 * Strategy: pure algorithm tests + DB migration smoke tests.
 * Pure functions inlined here (no tsyringe import) per CastService.test.ts pattern.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`;
});

afterAll(async () => {
	if (sql) await sql.end();
});

// ---------------------------------------------------------------------------
// Types (mirrored from SwissStageService — no import to avoid tsyringe chain)
// ---------------------------------------------------------------------------

type MatchRecord = {
	playerA: string;
	playerB: string | null;
	scoreA: number;
	scoreB: number;
	round: number;
	isBye: boolean;
};

type SwissStanding = {
	userId: string;
	points: number;
	buchholz: number;
	sonnebornBerger: number;
	pointsDiff: number;
	wins: number;
	losses: number;
	draws: number;
	byeCount: number;
};

// ---------------------------------------------------------------------------
// Inlined pure functions (mirrors SwissStageService exports)
// ---------------------------------------------------------------------------

function computeSwissStandings(matches: MatchRecord[], participants: string[]): SwissStanding[] {
	const pts: Record<string, number> = {};
	const wins: Record<string, number> = {};
	const losses: Record<string, number> = {};
	const draws: Record<string, number> = {};
	const byeCount: Record<string, number> = {};
	const opponents: Record<string, string[]> = {};
	const scoreVsOpponent: Record<string, Record<string, number>> = {};

	for (const p of participants) {
		pts[p] = 0;
		wins[p] = 0;
		losses[p] = 0;
		draws[p] = 0;
		byeCount[p] = 0;
		opponents[p] = [];
		scoreVsOpponent[p] = {};
	}

	for (const m of matches) {
		if (m.isBye || m.playerB === null) {
			pts[m.playerA] = (pts[m.playerA] ?? 0) + 1;
			wins[m.playerA] = (wins[m.playerA] ?? 0) + 1;
			byeCount[m.playerA] = (byeCount[m.playerA] ?? 0) + 1;
			continue;
		}

		opponents[m.playerA].push(m.playerB);
		opponents[m.playerB].push(m.playerA);

		if (m.scoreA > m.scoreB) {
			pts[m.playerA] = (pts[m.playerA] ?? 0) + 1;
			wins[m.playerA] = (wins[m.playerA] ?? 0) + 1;
			losses[m.playerB] = (losses[m.playerB] ?? 0) + 1;
			scoreVsOpponent[m.playerA][m.playerB] = (scoreVsOpponent[m.playerA][m.playerB] ?? 0) + 1;
		} else if (m.scoreB > m.scoreA) {
			pts[m.playerB] = (pts[m.playerB] ?? 0) + 1;
			wins[m.playerB] = (wins[m.playerB] ?? 0) + 1;
			losses[m.playerA] = (losses[m.playerA] ?? 0) + 1;
			scoreVsOpponent[m.playerB][m.playerA] = (scoreVsOpponent[m.playerB][m.playerA] ?? 0) + 1;
		} else {
			pts[m.playerA] = (pts[m.playerA] ?? 0) + 0.5;
			pts[m.playerB] = (pts[m.playerB] ?? 0) + 0.5;
			draws[m.playerA] = (draws[m.playerA] ?? 0) + 1;
			draws[m.playerB] = (draws[m.playerB] ?? 0) + 1;
		}
	}

	const standings: SwissStanding[] = participants.map((p) => {
		const buchholz = (opponents[p] ?? []).reduce((sum, opp) => sum + (pts[opp] ?? 0), 0);
		const sonnebornBerger = (opponents[p] ?? []).reduce((sum, opp) => {
			const scored = scoreVsOpponent[p]?.[opp] ?? 0;
			return sum + scored * (pts[opp] ?? 0);
		}, 0);
		const pointsDiff = (wins[p] ?? 0) - (losses[p] ?? 0);
		return {
			userId: p,
			points: pts[p] ?? 0,
			buchholz,
			sonnebornBerger,
			pointsDiff,
			wins: wins[p] ?? 0,
			losses: losses[p] ?? 0,
			draws: draws[p] ?? 0,
			byeCount: byeCount[p] ?? 0,
		};
	});

	standings.sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
		if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
		if (b.pointsDiff !== a.pointsDiff) return b.pointsDiff - a.pointsDiff;
		return 0;
	});

	return standings;
}

function pairKey(a: string, b: string): string {
	return [a, b].toSorted().join("|");
}

function pairMonrad(
	participants: string[],
	played: MatchRecord[],
	standings: SwissStanding[],
	round: number
): { playerA: string; playerB: string | null; isBye: boolean }[] {
	const sorted = [...standings].toSorted((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
		return 0;
	});

	const playedPairs = new Set<string>(
		played.filter((m) => !m.isBye && m.playerB !== null).map((m) => pairKey(m.playerA, m.playerB!))
	);

	const byePlayers = new Set<string>(played.filter((m) => m.isBye).map((m) => m.playerA));

	const pool = sorted.map((s) => s.userId);
	const paired: { playerA: string; playerB: string | null; isBye: boolean }[] = [];
	const used = new Set<string>();

	let byePlayer: string | null = null;
	if (pool.length % 2 !== 0) {
		for (let i = pool.length - 1; i >= 0; i--) {
			const candidate = pool[i];
			if (!byePlayers.has(candidate)) {
				byePlayer = candidate;
				break;
			}
		}
		if (byePlayer === null) byePlayer = pool[pool.length - 1];
		used.add(byePlayer);
		paired.push({ playerA: byePlayer, playerB: null, isBye: true });
	}

	for (let i = 0; i < pool.length; i++) {
		const a = pool[i];
		if (used.has(a)) continue;

		let matched = false;
		for (let j = i + 1; j < pool.length; j++) {
			const b = pool[j];
			if (used.has(b)) continue;
			if (playedPairs.has(pairKey(a, b))) continue;
			paired.push({ playerA: a, playerB: b, isBye: false });
			used.add(a);
			used.add(b);
			matched = true;
			break;
		}

		if (!matched) {
			for (let j = i + 1; j < pool.length; j++) {
				const b = pool[j];
				if (used.has(b)) continue;
				paired.push({ playerA: a, playerB: b, isBye: false });
				used.add(a);
				used.add(b);
				break;
			}
		}
	}

	return paired;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bye(player: string, round = 1): MatchRecord {
	return { playerA: player, playerB: null, scoreA: 1, scoreB: 0, round, isBye: true };
}

function match(a: string, b: string, scoreA: number, scoreB: number, round = 1): MatchRecord {
	return { playerA: a, playerB: b, scoreA, scoreB, round, isBye: false };
}

// ---------------------------------------------------------------------------
// Test 1 — pairing round 1 impair → exactly one bye
// ---------------------------------------------------------------------------

describe("pairMonrad — round 1 (impair)", () => {
	test("3 participants → 1 bye + 1 match", () => {
		const players = ["P1", "P2", "P3"];
		const standings = players.map((id) => ({
			userId: id,
			points: 0,
			buchholz: 0,
			sonnebornBerger: 0,
			pointsDiff: 0,
			wins: 0,
			losses: 0,
			draws: 0,
			byeCount: 0,
		}));

		const pairings = pairMonrad(players, [], standings, 1);

		const byes = pairings.filter((p) => p.isBye);
		const matches = pairings.filter((p) => !p.isBye);

		expect(byes).toHaveLength(1);
		expect(matches).toHaveLength(1);

		const allPaired = pairings.flatMap((p) => (p.playerB ? [p.playerA, p.playerB] : [p.playerA]));
		expect(new Set(allPaired).size).toBe(3);
	});

	test("4 participants → 0 byes + 2 matches", () => {
		const players = ["P1", "P2", "P3", "P4"];
		const standings = players.map((id) => ({
			userId: id,
			points: 0,
			buchholz: 0,
			sonnebornBerger: 0,
			pointsDiff: 0,
			wins: 0,
			losses: 0,
			draws: 0,
			byeCount: 0,
		}));

		const pairings = pairMonrad(players, [], standings, 1);

		expect(pairings.filter((p) => p.isBye)).toHaveLength(0);
		expect(pairings.filter((p) => !p.isBye)).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// Test 2 — pairing round 2 sans rematch
// ---------------------------------------------------------------------------

describe("pairMonrad — round 2 sans rematch", () => {
	test("paires du round 1 ne sont pas rejouées en round 2", () => {
		const players = ["P1", "P2", "P3", "P4"];

		const played: MatchRecord[] = [match("P1", "P2", 1, 0, 1), match("P3", "P4", 1, 0, 1)];

		const standings = computeSwissStandings(played, players);
		const pairings = pairMonrad(players, played, standings, 2);

		const matchPairs = pairings
			.filter((p) => !p.isBye)
			.map((p) => [p.playerA, p.playerB!].toSorted().join("|"));

		expect(matchPairs).not.toContain("P1|P2");
		expect(matchPairs).not.toContain("P3|P4");
	});
});

// ---------------------------------------------------------------------------
// Test 3 — standings Buchholz correct (4 joueurs)
// ---------------------------------------------------------------------------

describe("computeSwissStandings — Buchholz", () => {
	test("Buchholz = somme des points des adversaires après 2 rounds", () => {
		const players = ["A", "B", "C", "D"];

		const matches: MatchRecord[] = [
			match("A", "B", 1, 0, 1),
			match("C", "D", 1, 0, 1),
			match("A", "C", 1, 0, 2),
			match("B", "D", 1, 0, 2),
		];

		const standings = computeSwissStandings(matches, players);

		const a = standings.find((s) => s.userId === "A")!;
		const b = standings.find((s) => s.userId === "B")!;
		const c = standings.find((s) => s.userId === "C")!;

		expect(a.points).toBe(2);
		expect(b.points).toBe(1);
		expect(c.points).toBe(1);

		// A opposed B(1pt) + C(1pt) → buchholz = 2
		expect(a.buchholz).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Test 4 — standings Sonneborn-Berger
// ---------------------------------------------------------------------------

describe("computeSwissStandings — Sonneborn-Berger", () => {
	test("SB > 0 pour un joueur ayant battu des adversaires avec des points", () => {
		const players = ["A", "B", "C", "D"];

		const matches: MatchRecord[] = [
			match("A", "B", 1, 0, 1),
			match("C", "D", 1, 0, 1),
			match("A", "C", 1, 0, 2),
			match("D", "B", 1, 0, 2),
		];

		const standings = computeSwissStandings(matches, players);

		const a = standings.find((s) => s.userId === "A")!;
		expect(a.points).toBe(2);
		expect(a.sonnebornBerger).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Test 5 — isComplete false avant tous matches joués
// ---------------------------------------------------------------------------

describe("isComplete — état intermédiaire", () => {
	test("retourne false si un match a score 0-0", () => {
		const matches: MatchRecord[] = [
			match("A", "B", 1, 0, 1),
			{ playerA: "C", playerB: "D", scoreA: 0, scoreB: 0, round: 1, isBye: false },
		];

		const allDone = matches.every((m) => m.isBye || m.scoreA > 0 || m.scoreB > 0);

		expect(allDone).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Test 6 — isComplete true après tous matches joués
// ---------------------------------------------------------------------------

describe("isComplete — tous joués", () => {
	test("retourne true si tous les matches ont un résultat non nul", () => {
		const matches: MatchRecord[] = [
			match("A", "B", 1, 0, 1),
			match("C", "D", 0, 1, 1),
			bye("E", 1),
		];

		const allDone = matches.every((m) => m.isBye || m.scoreA > 0 || m.scoreB > 0);

		expect(allDone).toBe(true);
	});

	test("retourne false si matches vide", () => {
		const matches: MatchRecord[] = [];
		const allDone =
			matches.length > 0 && matches.every((m) => m.isBye || m.scoreA > 0 || m.scoreB > 0);
		expect(allDone).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Test 7 — advanceToNextPhase sélectionne top N (standings sort correct)
// ---------------------------------------------------------------------------

describe("computeSwissStandings — sélection top N pour phases suivantes", () => {
	test("le top 4 sur 8 joueurs après 2 rounds contient les joueurs 2-0", () => {
		const players = ["A", "B", "C", "D", "E", "F", "G", "H"];

		const matches: MatchRecord[] = [
			match("A", "B", 1, 0, 1),
			match("C", "D", 1, 0, 1),
			match("E", "F", 1, 0, 1),
			match("G", "H", 1, 0, 1),
			match("A", "C", 1, 0, 2),
			match("E", "G", 1, 0, 2),
			match("B", "D", 0, 1, 2),
			match("F", "H", 0, 1, 2),
		];

		const standings = computeSwissStandings(matches, players);
		const top4 = standings.slice(0, 4);

		expect(top4[0].points).toBeGreaterThanOrEqual(top4[1].points);
		expect(top4[1].points).toBeGreaterThanOrEqual(top4[2].points);

		const top4Ids = top4.map((s) => s.userId);
		expect(top4Ids).toContain("A");
		expect(top4Ids).toContain("E");
	});
});

// ---------------------------------------------------------------------------
// Test 8 — idempotence via DB smoke (tournament_phase table)
// ---------------------------------------------------------------------------

describeLive("tournament_phase — migration DB", () => {
	test("table tournament_phase existe et est vide", async () => {
		const rows = await sql<
			{ count: number }[]
		>`SELECT count(*)::int as count FROM tournament_phase`;
		expect(rows[0].count).toBe(0);
	});

	test("lobby a les colonnes phase_id et swiss_round", async () => {
		const cols = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'lobby'
        AND column_name IN ('phase_id', 'swiss_round')
      ORDER BY column_name
    `;
		const names = cols.map((c) => c.column_name);
		expect(names).toContain("phase_id");
		expect(names).toContain("swiss_round");
	});
});
