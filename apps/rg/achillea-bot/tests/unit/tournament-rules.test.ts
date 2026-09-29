/**
 * Tests unitaires PURS des règles métier tournoi (`@rosegriffon/achillea-core`) +
 * du helper de pagination (src/api/models/interfaces/Paginated.ts). Aucune DB.
 *
 * Verrouille deux régressions corrigées :
 *  - autorisation organisateur : l'ancien prédicat `managers.some((to) => to.id)` était
 *    toujours vrai dès qu'un manager existait → n'importe qui devenait organisateur ;
 *  - série DOUBLE_LEG à égalité : seriesWinner restait null → le lobby ne passait jamais
 *    FINISHED et le tournoi se bloquait. Désormais `tie` → litige.
 */
import { describe, expect, test } from "bun:test";

import { paginate } from "../../src/api/models/interfaces/Paginated";
import {
	computeSeriesOutcome,
	type SeriesMatch,
	userIsTournamentOrganizer,
	MatchFormat,
	TeamSide,
} from "@rosegriffon/achillea-core";

const m = (scoreTeam1: number, scoreTeam2: number, isValidated = true): SeriesMatch => ({
	isValidated,
	scoreTeam1,
	scoreTeam2,
});

describe("userIsTournamentOrganizer", () => {
	test("le propriétaire de l'organisation est organisateur", () => {
		expect(userIsTournamentOrganizer("owner", [], [], "owner")).toBe(true);
	});

	test("un manager d'organisation est organisateur", () => {
		expect(userIsTournamentOrganizer("owner", ["mgr"], [], "mgr")).toBe(true);
	});

	test("un TO rattaché au tournoi est organisateur", () => {
		expect(userIsTournamentOrganizer("owner", [], ["to"], "to")).toBe(true);
	});

	test("RÉGRESSION : un tiers n'est PAS organisateur même si des managers existent", () => {
		// L'ancien code `managers.some((to) => to.id)` renvoyait true ici (truthy).
		expect(userIsTournamentOrganizer("owner", ["mgr"], ["to1", "to2"], "intrus")).toBe(false);
	});

	test("aucun manager, aucun TO, tiers → false", () => {
		expect(userIsTournamentOrganizer("owner", [], [], "intrus")).toBe(false);
	});
});

describe("computeSeriesOutcome — formats BO impairs", () => {
	test("BO1 : 1 manche gagnée par T1 → décidé T1", () => {
		const o = computeSeriesOutcome(MatchFormat.BO1, [m(1, 0)]);
		expect(o.status).toBe("decided");
		if (o.status === "decided") expect(o.winner).toBe(TeamSide.TEAM_1);
	});

	test("BO3 : premier à 2 manches → décidé", () => {
		const o = computeSeriesOutcome(MatchFormat.BO3, [m(1, 0), m(0, 1), m(1, 0)]);
		expect(o.status).toBe("decided");
		if (o.status === "decided") {
			expect(o.winner).toBe(TeamSide.TEAM_1);
			expect(o.scoreT1).toBe(2);
			expect(o.scoreT2).toBe(1);
		}
	});

	test("BO3 : 1-0 puis 2 manches non validées → pending (seuil non atteint)", () => {
		const o = computeSeriesOutcome(MatchFormat.BO3, [m(1, 0), m(0, 0, false), m(0, 0, false)]);
		expect(o.status).toBe("pending");
	});

	test("BO5 : 0-3 → décidé T2", () => {
		const o = computeSeriesOutcome(MatchFormat.BO5, [m(0, 1), m(0, 1), m(0, 1)]);
		expect(o.status).toBe("decided");
		if (o.status === "decided") expect(o.winner).toBe(TeamSide.TEAM_2);
	});
});

describe("computeSeriesOutcome — DOUBLE_LEG (cumul des 2 manches)", () => {
	test("cumul favorable à T1 → décidé T1", () => {
		const o = computeSeriesOutcome(MatchFormat.DOUBLE_LEG, [m(3, 1), m(0, 1)]);
		expect(o.status).toBe("decided");
		if (o.status === "decided") {
			expect(o.winner).toBe(TeamSide.TEAM_1);
			expect(o.scoreT1).toBe(3);
			expect(o.scoreT2).toBe(2);
		}
	});

	test("RÉGRESSION : cumul à égalité (1-0 puis 0-1) → tie (litige, pas de blocage)", () => {
		const o = computeSeriesOutcome(MatchFormat.DOUBLE_LEG, [m(1, 0), m(0, 1)]);
		expect(o.status).toBe("tie");
	});

	test("une manche non validée → pending (on attend la 2e manche)", () => {
		const o = computeSeriesOutcome(MatchFormat.DOUBLE_LEG, [m(2, 0), m(0, 0, false)]);
		expect(o.status).toBe("pending");
	});
});

describe("paginate", () => {
	test("total 0 → data vide, pageCount 0", () => {
		const r = paginate([], 0, 25, 1);
		expect(r.data).toEqual([]);
		expect(r.meta).toEqual({ page: 1, limit: 25, total: 0, pageCount: 0 });
	});

	test("pagination normale → meta cohérente", () => {
		const items = [{ id: 1 }, { id: 2 }];
		const r = paginate(items, 30, 25, 1);
		expect(r.data).toBe(items);
		expect(r.meta).toEqual({ page: 1, limit: 25, total: 30, pageCount: 2 });
	});

	test("page hors limite → BadRequest", () => {
		expect(() => paginate([], 10, 25, 5)).toThrow();
	});
});
