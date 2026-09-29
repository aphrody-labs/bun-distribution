/**
 * Tests unitaires — barème AP podium tournoi.
 * Run: bun test tests/unit/tournament-placement-prizes.test.ts
 */

import { describe, expect, test } from "bun:test";

import { placementPrizeAp, prizeTableForTournamentSize, applyEloUpdate } from "@rosegriffon/achillea-core";

describe("prizeTableForTournamentSize", () => {
	test("Evo 32 (petit tournoi) → 50 / 25 / 10", () => {
		expect(prizeTableForTournamentSize(32)).toEqual({
			first: 50,
			second: 25,
			semi: 10,
		});
	});

	test("bornes de tranches (inclusives sur le max)", () => {
		expect(prizeTableForTournamentSize(8).first).toBe(25);
		expect(prizeTableForTournamentSize(9).first).toBe(35);
		expect(prizeTableForTournamentSize(16).first).toBe(35);
		expect(prizeTableForTournamentSize(17).first).toBe(50);
		expect(prizeTableForTournamentSize(64).first).toBe(80);
		expect(prizeTableForTournamentSize(128).first).toBe(120);
		expect(prizeTableForTournamentSize(256).first).toBe(180);
	});

	test("taille invalide / 0 → table micro (≤8)", () => {
		expect(prizeTableForTournamentSize(0).first).toBe(25);
		expect(prizeTableForTournamentSize(-3).first).toBe(25);
		expect(prizeTableForTournamentSize(Number.NaN).first).toBe(25);
	});
});

describe("placementPrizeAp", () => {
	test("podium 32 joueurs", () => {
		expect(placementPrizeAp(32, 1)).toBe(50);
		expect(placementPrizeAp(32, 2)).toBe(25);
		expect(placementPrizeAp(32, 3)).toBe(10);
		expect(placementPrizeAp(32, 4)).toBe(10);
	});

	test("hors podium → 0", () => {
		expect(placementPrizeAp(32, 5)).toBe(0);
		expect(placementPrizeAp(32, 16)).toBe(0);
	});

	test("rank invalide → 0", () => {
		expect(placementPrizeAp(32, 0)).toBe(0);
		expect(placementPrizeAp(32, -1)).toBe(0);
		expect(placementPrizeAp(32, Number.NaN)).toBe(0);
	});

	test("demi-finalistes (rank 3 partagé brackets-manager) reçoivent le semi", () => {
		// single elim sans consolation : les 2 demis ont souvent rank=3
		expect(placementPrizeAp(32, 3)).toBe(10);
		expect(placementPrizeAp(32, 3)).toBe(placementPrizeAp(32, 4));
	});

	test("plus gros tournoi (64) monte le barème", () => {
		expect(placementPrizeAp(64, 1)).toBe(80);
		expect(placementPrizeAp(64, 2)).toBe(40);
		expect(placementPrizeAp(64, 3)).toBe(15);
	});
});

describe("application bonus via applyEloUpdate", () => {
	test("bonus plat s'ajoute à l'Elo sans clamp négatif", () => {
		const prize = placementPrizeAp(32, 1);
		const { newElo, clampedDelta } = applyEloUpdate(120, prize);
		expect(clampedDelta).toBe(50);
		expect(newElo).toBe(170);
	});

	test("bonus depuis 0 AP (nouveau joueur vainqueur)", () => {
		const prize = placementPrizeAp(32, 1);
		const { newElo, clampedDelta } = applyEloUpdate(0, prize);
		expect(newElo).toBe(50);
		expect(clampedDelta).toBe(50);
	});
});
