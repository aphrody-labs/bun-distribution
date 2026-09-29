/**
 * Tests unitaires PURS des règles de création de tournoi
 * (`@rosegriffon/achillea-core`, lot H de `docs/plan-tournois.md`).
 *
 * Règle du cadrage : « un tournoi se doit d'être publié au moins 1 semaine à l'avance
 * et ne peut pas être publié plus de X semaines/mois à l'avance ; une organisation ne
 * peut pas avoir plus de X tournois ouverts en même temps ».
 *
 * Ce qui est verrouillé ici : les bornes sont **inclusives du côté autorisé** (publier
 * pile à 7 jours doit passer), et le plafond compare bien `>=` — un plafond testé avec
 * `>` laisserait créer un tournoi de trop.
 */
import { describe, expect, test } from "bun:test";

import {
	checkOpenTournamentsLimit,
	checkPublicationWindow,
	computeWaitlistPositions,
	DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG,
	DEFAULT_PUBLICATION_WINDOW,
	leadTimeInDays,
	ParticipantStatus,
} from "@rosegriffon/achillea-core";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe("leadTimeInDays", () => {
	test("compte les jours entre maintenant et le début", () => {
		expect(leadTimeInDays(inDays(10), NOW)).toBeCloseTo(10, 6);
	});

	test("est négatif pour une date passée", () => {
		expect(leadTimeInDays(inDays(-2), NOW)).toBeCloseTo(-2, 6);
	});
});

describe("checkPublicationWindow", () => {
	test("accepte une date au-delà du délai minimum", () => {
		expect(checkPublicationWindow(inDays(30), NOW)).toBeNull();
	});

	test("accepte pile le délai minimum (borne inclusive)", () => {
		expect(checkPublicationWindow(inDays(DEFAULT_PUBLICATION_WINDOW.minLeadDays), NOW)).toBeNull();
	});

	test("refuse une publication trop tardive", () => {
		const violation = checkPublicationWindow(inDays(3), NOW);
		expect(violation?.rule).toBe("min_lead_time");
		expect(violation?.message).toContain("7 jours");
	});

	test("refuse une date passée", () => {
		expect(checkPublicationWindow(inDays(-1), NOW)?.rule).toBe("min_lead_time");
	});

	test("refuse un horizon trop lointain", () => {
		const violation = checkPublicationWindow(
			inDays(DEFAULT_PUBLICATION_WINDOW.maxLeadDays + 1),
			NOW
		);
		expect(violation?.rule).toBe("max_lead_time");
	});

	test("accepte pile l'horizon maximum (borne inclusive)", () => {
		expect(checkPublicationWindow(inDays(DEFAULT_PUBLICATION_WINDOW.maxLeadDays), NOW)).toBeNull();
	});

	test("respecte une fenêtre personnalisée (variables d'environnement)", () => {
		const window = { minLeadDays: 1, maxLeadDays: 14 };
		expect(checkPublicationWindow(inDays(2), NOW, window)).toBeNull();
		expect(checkPublicationWindow(inDays(20), NOW, window)?.rule).toBe("max_lead_time");
	});
});

describe("checkOpenTournamentsLimit", () => {
	test("accepte sous le plafond", () => {
		expect(checkOpenTournamentsLimit(DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG - 1)).toBeNull();
	});

	test("refuse pile au plafond (le nouveau serait celui de trop)", () => {
		const violation = checkOpenTournamentsLimit(DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG);
		expect(violation?.rule).toBe("max_open_tournaments");
	});

	test("refuse au-delà du plafond", () => {
		expect(checkOpenTournamentsLimit(DEFAULT_MAX_OPEN_TOURNAMENTS_PER_ORG + 3)).not.toBeNull();
	});

	test("respecte un plafond personnalisé", () => {
		expect(checkOpenTournamentsLimit(1, 2)).toBeNull();
		expect(checkOpenTournamentsLimit(2, 2)?.rule).toBe("max_open_tournaments");
	});

	test("une organisation sans tournoi ouvert passe toujours", () => {
		expect(checkOpenTournamentsLimit(0)).toBeNull();
		expect(checkOpenTournamentsLimit(0, 0)).not.toBeNull(); // plafond nul = création bloquée
	});
});

describe("computeWaitlistPositions", () => {
	const p = (id: number, status: ParticipantStatus, minutesAgo: number) => ({
		id,
		status,
		registeredAt: new Date(NOW.getTime() - minutesAgo * 60_000),
	});

	test("numérote les seuls joueurs en attente, par ordre d'inscription", () => {
		const positions = computeWaitlistPositions([
			p(1, ParticipantStatus.ACTIVE, 90),
			p(2, ParticipantStatus.WAITLISTED, 30),
			p(3, ParticipantStatus.WAITLISTED, 60),
			p(4, ParticipantStatus.DISQUALIFIED, 10),
		]);

		expect(positions.get(3)).toBe(1); // inscrit le premier des deux en attente
		expect(positions.get(2)).toBe(2);
		expect(positions.has(1)).toBe(false);
		expect(positions.has(4)).toBe(false);
	});

	test("départage deux inscriptions simultanées par id (ordre DB non garanti)", () => {
		const positions = computeWaitlistPositions([
			p(20, ParticipantStatus.WAITLISTED, 5),
			p(10, ParticipantStatus.WAITLISTED, 5),
		]);

		expect(positions.get(10)).toBe(1);
		expect(positions.get(20)).toBe(2);
	});

	test("les positions restent contiguës après une promotion", () => {
		const before = [
			p(1, ParticipantStatus.WAITLISTED, 30),
			p(2, ParticipantStatus.WAITLISTED, 20),
			p(3, ParticipantStatus.WAITLISTED, 10),
		];
		expect([...computeWaitlistPositions(before).values()].sort()).toEqual([1, 2, 3]);

		// Le premier est promu : les suivants remontent, sans trou.
		const after = [{ ...before[0], status: ParticipantStatus.ACTIVE }, before[1], before[2]];
		const positions = computeWaitlistPositions(after);
		expect(positions.get(2)).toBe(1);
		expect(positions.get(3)).toBe(2);
		expect(positions.size).toBe(2);
	});

	test("sans liste d'attente, la table est vide", () => {
		expect(computeWaitlistPositions([p(1, ParticipantStatus.ACTIVE, 5)]).size).toBe(0);
	});
});
