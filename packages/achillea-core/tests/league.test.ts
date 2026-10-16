/**
 * Tests moteur ligue / Asytral League.
 * Run: bun test packages/core/tests/league.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
	ASYTRAL_POINTS,
	ASYTRAL_REGULAR_RESULTS,
	ASYTRAL_TEAMS,
	computeLeagueTable,
	generateDoubleRoundRobin,
	generateSingleRoundRobin,
	headToHead,
	matchdayCount,
} from "../src/league";

const TEAMS = ASYTRAL_TEAMS.map((t) => t.tag);

describe("generateSingleRoundRobin", () => {
	test("8 équipes → 28 matchs, 7 journées, chaque paire une fois", () => {
		const fixtures = generateSingleRoundRobin(TEAMS);
		expect(fixtures).toHaveLength(28);
		expect(matchdayCount(8)).toBe(7);
		expect(new Set(fixtures.map((f) => f.matchday)).size).toBe(7);

		const pairs = new Set<string>();
		for (const f of fixtures) {
			const key = [f.homeId, f.awayId].sort().join("-");
			expect(pairs.has(key)).toBe(false);
			pairs.add(key);
		}
		expect(pairs.size).toBe(28);
	});

	test("chaque équipe joue 7 matchs (une par journée)", () => {
		const fixtures = generateSingleRoundRobin(TEAMS);
		for (const t of TEAMS) {
			const played = fixtures.filter((f) => f.homeId === t || f.awayId === t);
			expect(played).toHaveLength(7);
			const days = new Set(played.map((f) => f.matchday));
			expect(days.size).toBe(7);
		}
	});

	test("nombre impair → bye silencieux, (n) journées", () => {
		const five = ["A", "B", "C", "D", "E"];
		const fixtures = generateSingleRoundRobin(five);
		expect(fixtures).toHaveLength(10);
		expect(matchdayCount(5)).toBe(5);
	});
});

describe("generateDoubleRoundRobin", () => {
	test("double le calendrier (aller-retour)", () => {
		const d = generateDoubleRoundRobin(["A", "B", "C", "D"]);
		expect(d).toHaveLength(12);
		expect(new Set(d.map((f) => f.matchday)).size).toBe(6);
	});
});

describe("computeLeagueTable — barème Asytral", () => {
	test("reproduit le classement officiel S1 (top 4 + dernier)", () => {
		const table = computeLeagueTable(TEAMS, ASYTRAL_REGULAR_RESULTS, ASYTRAL_POINTS);

		expect(table).toHaveLength(8);
		// Top 4 sheet : GKO 17, OMP 15, ASE 14, DR 12
		expect(table[0]!.teamId).toBe("GKO");
		expect(table[0]!.points).toBe(17);
		expect(table[0]!.played).toBe(7);

		expect(table[1]!.teamId).toBe("OMP");
		expect(table[1]!.points).toBe(15);

		expect(table[2]!.teamId).toBe("ASE");
		expect(table[2]!.points).toBe(14);

		expect(table[3]!.teamId).toBe("DR");
		expect(table[3]!.points).toBe(12);

		expect(table[7]!.teamId).toBe("ZOO");
		expect(table[7]!.points).toBe(2);

		const fgs = table.find((r) => r.teamId === "FGS")!;
		expect(fgs.points).toBe(11);
		expect(fgs.winsOt).toBe(2);
		expect(fgs.lossesOt).toBe(1);
	});

	test("but en or 1-1 + winnerId : +2 / +1", () => {
		const table = computeLeagueTable(
			["A", "B"],
			[
				{
					matchday: 1,
					homeId: "A",
					awayId: "B",
					homeScore: 1,
					awayScore: 1,
					overtime: true,
					winnerId: "A",
				},
			],
			ASYTRAL_POINTS
		);
		const a = table.find((r) => r.teamId === "A")!;
		const b = table.find((r) => r.teamId === "B")!;
		expect(a.points).toBe(2);
		expect(a.winsOt).toBe(1);
		expect(b.points).toBe(1);
		expect(b.lossesOt).toBe(1);
		expect(a.mapDiff).toBe(0);
	});

	test("tie-break head-to-head après points + mapDiff égaux", () => {
		// A bat B (2-1) ; B bat C (2-1) ; C bat A (2-1) → triangle, ou plus simple :
		// A 3 pts, B 3 pts, même diff, A a battu B.
		const r2 = [
			{ matchday: 1, homeId: "A", awayId: "B", homeScore: 2, awayScore: 1 },
			{ matchday: 2, homeId: "B", awayId: "C", homeScore: 2, awayScore: 1 },
			{ matchday: 3, homeId: "A", awayId: "C", homeScore: 1, awayScore: 2 },
		];
		// A: +3 (vs B), +0 (vs C) = 3 pts ; maps 3-3 diff 0
		// B: +0 (vs A), +3 (vs C) = 3 pts ; maps 3-3 diff 0
		expect(headToHead("A", "B", r2)).toBe(1);
		const standings = computeLeagueTable(["A", "B", "C"], r2, ASYTRAL_POINTS);
		const a = standings.find((x) => x.teamId === "A")!;
		const b = standings.find((x) => x.teamId === "B")!;
		expect(a.points).toBe(3);
		expect(b.points).toBe(3);
		expect(a.mapDiff).toBe(b.mapDiff);
		expect(a.rank).toBeLessThan(b.rank);
	});
});
