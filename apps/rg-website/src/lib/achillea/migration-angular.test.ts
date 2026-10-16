import { describe, expect, test } from "bun:test";

import { isTournamentOrganizer, rankImagePath } from "@rosegriffon/achillea-core";

import { achilleaApiUrl, createAchilleaClient } from "./client";

/**
 * Tests migrés depuis `apps/achillea-web/tests/`.
 *
 * POURQUOI LES REJOUER PLUTÔT QUE LES SUPPRIMER
 * Chacun de ces tests gardait un défaut CONSTATÉ dans le front Angular. Le
 * portage vers Next a remplacé les implémentations (helpers Angular →
 * `@rosegriffon/achillea-core` et `@rosegriffon/achillea-client`) : rien ne
 * garantissait que les nouvelles portent les mêmes garanties. Les rejouer
 * contre les nouvelles implémentations est la seule façon de le savoir.
 *
 * Correspondances :
 * - `tests/tournament-organizer.test.ts` → `isTournamentOrganizer` (core)
 * - `tests/elo-image.test.ts`            → `rankImagePath` (core)
 * - `tests/api-url.test.ts`              → `AchilleaHttp.url` (client)
 *
 * `tests/hero-bg-fx.test.ts` est déjà migré dans `hero-bg-fx.test.ts`.
 * `tests/dom.test.ts` ne testait que le bon amorçage de happy-dom sous Angular :
 * il n'a pas d'équivalent ici et n'est pas repris.
 */

// ─── tests/tournament-organizer.test.ts ──────────────────────────────────────

const tournoi = {
	managers: [{ id: "to-1" }, { id: "to-2" }],
	organization: {
		// Forme réelle de l'API : pas d'identifiant au premier niveau, seulement
		// l'utilisateur imbriqué.
		managers: [{ user: { id: "org-mgr-1" } }, { user: { id: "org-mgr-2" } }],
		owner: { id: "owner-1" },
	},
};

describe("isTournamentOrganizer", () => {
	test("refuse un visiteur anonyme", () => {
		expect(isTournamentOrganizer(null, tournoi)).toBe(false);
		expect(isTournamentOrganizer(undefined, tournoi)).toBe(false);
		expect(isTournamentOrganizer({}, tournoi)).toBe(false);
		expect(isTournamentOrganizer({ id: null }, tournoi)).toBe(false);
		expect(isTournamentOrganizer({ role: 3 }, tournoi)).toBe(false);
	});

	/**
	 * Le bug de production qui a motivé le test d'origine : l'implémentation
	 * comparait `manager.id === user?.id` sur des managers d'organisation qui
	 * n'ont PAS d'`id` au premier niveau. Pour un visiteur anonyme, cela donnait
	 * `undefined === undefined`, donc vrai — l'interface d'organisateur
	 * s'ouvrait à tout le monde.
	 */
	test("ne confond pas deux identifiants absents", () => {
		const t = {
			managers: [],
			organization: {
				managers: [{ id: undefined, user: { id: "org-mgr-1" } }],
				owner: { id: "owner-1" },
			},
		};
		expect(isTournamentOrganizer(undefined, t)).toBe(false);
		expect(isTournamentOrganizer({ id: "inconnu" }, t)).toBe(false);
	});

	test("accepte propriétaire, manager d'organisation, organisateur et super-admin", () => {
		expect(isTournamentOrganizer({ id: "owner-1" }, tournoi)).toBe(true);
		expect(isTournamentOrganizer({ id: "org-mgr-2" }, tournoi)).toBe(true);
		expect(isTournamentOrganizer({ id: "to-1" }, tournoi)).toBe(true);
		expect(isTournamentOrganizer({ id: "quiconque", role: 3 }, tournoi)).toBe(true);
	});

	test("refuse un simple participant", () => {
		expect(isTournamentOrganizer({ id: "intrus", role: 0 }, tournoi)).toBe(false);
		expect(isTournamentOrganizer({ id: "intrus", role: 1 }, tournoi)).toBe(false);
	});

	test("tolère un tournoi ou une organisation absents", () => {
		expect(isTournamentOrganizer({ id: "x" }, null)).toBe(false);
		expect(isTournamentOrganizer({ id: "x" }, {})).toBe(false);
		expect(isTournamentOrganizer({ id: "x" }, { organization: null })).toBe(false);
	});
});

// ─── tests/elo-image.test.ts ─────────────────────────────────────────────────

describe("rankImagePath", () => {
	/**
	 * Les paliers sont nommés en français et accentués ; les fichiers livrés
	 * dans `public/ranks/` sont en ASCII. Un mapping qui laisserait passer
	 * l'accent produirait un 404 sur « Émeraude » et « Légendaire » seulement —
	 * deux paliers rares, donc un défaut qui survit longtemps en production.
	 */
	test("translittère les paliers accentués vers le nom de fichier livré", () => {
		expect(rankImagePath("Fer")).toBe("ranks/fer.webp");
		expect(rankImagePath("Diamant")).toBe("ranks/diamant.webp");
		expect(rankImagePath("Émeraude")).toBe("ranks/emeraude.webp");
		expect(rankImagePath("Rubis")).toBe("ranks/rubis.webp");
		expect(rankImagePath("Légendaire")).toBe("ranks/legendaire.webp");
	});

	test("retombe sur Fer plutôt que de rendre un chemin vide", () => {
		expect(rankImagePath(null)).toBe("ranks/fer.webp");
		expect(rankImagePath(undefined)).toBe("ranks/fer.webp");
		expect(rankImagePath("palier-inexistant")).toBe("ranks/fer.webp");
	});

	test("ne produit jamais de double barre, quelle que soit la base", () => {
		expect(rankImagePath("Fer", "/ranks/")).toBe("/ranks/fer.webp");
		expect(rankImagePath("Fer", "/ranks")).toBe("/ranks/fer.webp");
	});
});

// ─── tests/api-url.test.ts ───────────────────────────────────────────────────

describe("construction des URL d'API", () => {
	const url = (chemin: string) => createAchilleaClient().http.url(chemin);

	test("l'origine est lue à l'appel, jamais au chargement du module", () => {
		// Un module qui lirait `process.env` à l'import serait inutilisable côté
		// navigateur, où la variable n'existe pas.
		expect(achilleaApiUrl()).toMatch(/^https?:\/\//);
	});

	test("préfixe un chemin par l'origine de l'API", () => {
		expect(url("/clans")).toBe(`${achilleaApiUrl()}/clans`);
	});

	/**
	 * Le défaut gardé par le test d'origine : concaténer une base finissant par
	 * `/` avec un chemin commençant par `/` donnait `//clans`, que le serveur
	 * traite comme une URL protocole-relative.
	 */
	test("ne double jamais la barre de jonction", () => {
		expect(url("/clans")).not.toContain("//clans");
		expect(url("clans")).not.toContain("//clans");
	});

	test("deux chemins distincts donnent deux URL distinctes", () => {
		expect(url("/clans")).not.toBe(url("/ranked/tiers"));
	});
});
