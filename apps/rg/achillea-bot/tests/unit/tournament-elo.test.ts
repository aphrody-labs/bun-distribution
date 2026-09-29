/**
 * Tests unitaires — résolution d'issue + application Elo tournoi (logique pure).
 * Run: bun test tests/unit/tournament-elo.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
	progressiveEloDelta,
	applyEloUpdate,
	DEFAULT_K_FACTOR,
	resolveTournamentSideOutcome,
} from "@rosegriffon/achillea-core";

import { LobbyState, TeamSide } from "../../src/utils/enums";

describe("resolveTournamentSideOutcome", () => {
	test("score T1 > T2 → TEAM_1", () => {
		const r = resolveTournamentSideOutcome(
			[{ score: 3, forfeit: false }],
			[{ score: 1, forfeit: false }],
			LobbyState.FINISHED
		);
		expect(r?.winner).toBe(TeamSide.TEAM_1);
	});

	test("score T2 > T1 → TEAM_2", () => {
		const r = resolveTournamentSideOutcome(
			[{ score: 0, forfeit: false }],
			[{ score: 2, forfeit: false }],
			LobbyState.FINISHED
		);
		expect(r?.winner).toBe(TeamSide.TEAM_2);
	});

	test("forfait T1 → TEAM_2 gagne", () => {
		const r = resolveTournamentSideOutcome(
			[{ score: 0, forfeit: true }],
			[{ score: 0, forfeit: false }],
			LobbyState.FORFEITED
		);
		expect(r?.winner).toBe(TeamSide.TEAM_2);
	});

	test("forfait T2 → TEAM_1 gagne", () => {
		const r = resolveTournamentSideOutcome(
			[{ score: 0, forfeit: false }],
			[{ score: 0, forfeit: true }],
			LobbyState.FORFEITED
		);
		expect(r?.winner).toBe(TeamSide.TEAM_1);
	});

	test("double forfait → null", () => {
		const r = resolveTournamentSideOutcome(
			[{ score: 0, forfeit: true }],
			[{ score: 0, forfeit: true }],
			LobbyState.FORFEITED
		);
		expect(r).toBeNull();
	});

	test("égalité Finished → winner null (nul)", () => {
		const r = resolveTournamentSideOutcome(
			[{ score: 2, forfeit: false }],
			[{ score: 2, forfeit: false }],
			LobbyState.FINISHED
		);
		expect(r?.winner).toBeNull();
	});
});

describe("barème progressif tournoi = ranked (même formule)", () => {
	test("à Elo 0 égal, gagnant ~+20 (Fer), perdant clampé à 0", () => {
		const dWin = progressiveEloDelta(0, 0, 1, 0, DEFAULT_K_FACTOR);
		const dLoss = progressiveEloDelta(0, 0, 0, 0, DEFAULT_K_FACTOR);
		const upWin = applyEloUpdate(0, dWin);
		const upLoss = applyEloUpdate(0, dLoss);

		expect(upWin.clampedDelta).toBeGreaterThan(0);
		// Perdant déjà à 0 → delta clampé à 0
		expect(upLoss.newElo).toBe(0);
		expect(upLoss.clampedDelta).toBe(0);
	});

	test("à Elo 1000 égal (Émeraude), asymétrie se réduit", () => {
		const tier = 6; // Émeraude
		const dWin = progressiveEloDelta(1000, 1000, 1, tier, DEFAULT_K_FACTOR);
		const dLoss = progressiveEloDelta(1000, 1000, 0, tier, DEFAULT_K_FACTOR);
		expect(dWin).toBe(17);
		expect(dLoss).toBe(-13);
	});
});
