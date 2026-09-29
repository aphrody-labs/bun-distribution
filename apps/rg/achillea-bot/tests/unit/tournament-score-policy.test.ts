/**
 * Politique de saisie des scores d'un tournoi (staff seul / joueurs).
 *
 * Tests purs : la règle vit dans `@rosegriffon/achillea-core` et n'a besoin ni de base ni de DI.
 * Ce qui est verrouillé ici, c'est qu'un organisateur passe toujours, qu'un tournoi
 * d'avant l'option (politique absente) garde le comportement joueurs, et qu'une valeur
 * inconnue ne parte jamais vers la colonne — elle porte une contrainte CHECK.
 */
import { canReportTournamentScore } from "@rosegriffon/achillea-core";
import { describe, expect, test } from "bun:test";

import { parseScoreReportPolicy } from "../../src/services/tournament-policies";
import { ScoreReportPolicy } from "../../src/utils/enums";

describe("canReportTournamentScore", () => {
	test("un joueur du match saisit son score en politique joueurs", () => {
		expect(
			canReportTournamentScore(ScoreReportPolicy.PLAYERS, {
				isOrganizer: false,
				isLobbyPlayer: true,
			})
		).toBe(true);
	});

	test("le même joueur est refusé en politique staff seul", () => {
		expect(
			canReportTournamentScore(ScoreReportPolicy.STAFF_ONLY, {
				isOrganizer: false,
				isLobbyPlayer: true,
			})
		).toBe(false);
	});

	test("un organisateur passe quelle que soit la politique", () => {
		for (const policy of [ScoreReportPolicy.PLAYERS, ScoreReportPolicy.STAFF_ONLY]) {
			expect(canReportTournamentScore(policy, { isOrganizer: true, isLobbyPlayer: false })).toBe(
				true
			);
		}
	});

	test("un tiers (ni organisateur ni joueur du match) est toujours refusé", () => {
		expect(
			canReportTournamentScore(ScoreReportPolicy.PLAYERS, {
				isOrganizer: false,
				isLobbyPlayer: false,
			})
		).toBe(false);
	});

	test("politique absente = politique joueurs (tournois créés avant l'option)", () => {
		expect(canReportTournamentScore(null, { isOrganizer: false, isLobbyPlayer: true })).toBe(true);
		expect(canReportTournamentScore(undefined, { isOrganizer: false, isLobbyPlayer: true })).toBe(
			true
		);
	});
});

describe("parseScoreReportPolicy", () => {
	test("accepte les deux valeurs de l'énumération", () => {
		expect(parseScoreReportPolicy("staff_only")).toBe(ScoreReportPolicy.STAFF_ONLY);
		expect(parseScoreReportPolicy("players")).toBe(ScoreReportPolicy.PLAYERS);
	});

	test("retombe sur le défaut pour une valeur inconnue", () => {
		expect(parseScoreReportPolicy("nimporte quoi")).toBe(ScoreReportPolicy.PLAYERS);
		expect(parseScoreReportPolicy(undefined)).toBe(ScoreReportPolicy.PLAYERS);
		expect(parseScoreReportPolicy(null)).toBe(ScoreReportPolicy.PLAYERS);
	});

	test("conserve la valeur courante quand le formulaire n'envoie rien", () => {
		expect(parseScoreReportPolicy(undefined, ScoreReportPolicy.STAFF_ONLY)).toBe(
			ScoreReportPolicy.STAFF_ONLY
		);
	});
});
