/**
 * Tests unitaires — logique Elo pure du ranked.
 *
 * Couvre uniquement les fonctions pures (aucune DB, aucun Discord, aucun binding natif) :
 *   - `expectedScore` / `eloDelta` / `applyEloUpdate` ré-exportés par le bot
 *     (`src/ranked/elo.ts` → `@rosegriffon/achillea-core`), utilisés dans `ranked/persistence.ts`.
 *   - `computeMatchElo` + constantes (`@rosegriffon/achillea-core/elo`), cœur de `EloService.calculate`.
 *
 * Cas vérifiés : sens du delta (gagnant +, perdant −), symétrie / conservation,
 * bornage (clamp à 0), influence du K-factor, suivi du peak_rating, scores égaux.
 */

import { describe, expect, test } from "bun:test";

// Entrée prescrite côté bot (ranked) : ré-export pur depuis @rosegriffon/achillea-core.
import { applyEloUpdate, eloDelta, expectedScore } from "../../src/ranked/elo";
// Cœur partagé : duel gagnant/perdant + constantes.
import { computeMatchElo, DEFAULT_BASE_RATING, DEFAULT_K_FACTOR } from "@rosegriffon/achillea-core/elo";

describe("expectedScore — probabilité de victoire", () => {
	test("Elo égaux ⇒ 0.5 pile", () => {
		expect(expectedScore(1000, 1000)).toBe(0.5);
		expect(expectedScore(1500, 1500)).toBe(0.5);
	});

	test("favori (Elo supérieur) ⇒ > 0.5, outsider ⇒ < 0.5", () => {
		expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
		expect(expectedScore(1000, 1200)).toBeLessThan(0.5);
	});

	test("toujours borné dans ]0..1[", () => {
		for (const [a, b] of [
			[0, 4000],
			[4000, 0],
			[1000, 1000],
			[800, 2200],
		]) {
			const p = expectedScore(a, b);
			expect(p).toBeGreaterThan(0);
			expect(p).toBeLessThan(1);
		}
	});

	test("symétrie : E(A,B) + E(B,A) = 1", () => {
		expect(expectedScore(1300, 1100) + expectedScore(1100, 1300)).toBeCloseTo(1, 12);
	});

	test("monotone croissant avec l'Elo du joueur", () => {
		const faible = expectedScore(900, 1500);
		const moyen = expectedScore(1200, 1500);
		const fort = expectedScore(1500, 1500);
		expect(faible).toBeLessThan(moyen);
		expect(moyen).toBeLessThan(fort);
	});

	test("écart de 400 points ⇒ ~0.909 pour le favori (référence classique)", () => {
		expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 6);
	});
});

describe("eloDelta — sens et bornage", () => {
	test("le gagnant gagne des points (delta > 0)", () => {
		expect(eloDelta(1000, 1000, 1, DEFAULT_K_FACTOR)).toBeGreaterThan(0);
	});

	test("le perdant perd des points (delta < 0)", () => {
		expect(eloDelta(1000, 1000, 0, DEFAULT_K_FACTOR)).toBeLessThan(0);
	});

	test("Elo égaux + victoire ⇒ +K/2 arrondi (16 avec K=32)", () => {
		expect(eloDelta(1000, 1000, 1, 32)).toBe(16);
	});

	test("Elo égaux + défaite ⇒ −K/2 arrondi (−16 avec K=32)", () => {
		expect(eloDelta(1000, 1000, 0, 32)).toBe(-16);
	});

	test("match nul (actual = 0.5) entre Elo égaux ⇒ delta nul", () => {
		expect(eloDelta(1000, 1000, 0.5, 32)).toBe(0);
	});

	test("battre un plus fort rapporte plus que battre un plus faible", () => {
		const contreFort = eloDelta(1000, 1400, 1, 32);
		const contreFaible = eloDelta(1000, 600, 1, 32);
		expect(contreFort).toBeGreaterThan(contreFaible);
	});

	test("perdre contre un plus faible coûte plus que perdre contre un plus fort", () => {
		const contreFaible = eloDelta(1400, 1000, 0, 32);
		const contreFort = eloDelta(1000, 1400, 0, 32);
		// Les deux sont négatifs ; la défaite face au plus faible est la plus douloureuse.
		expect(contreFaible).toBeLessThan(contreFort);
	});

	test("résultat entier (arrondi) quel que soit l'écart", () => {
		const d = eloDelta(1234, 987, 1, 32);
		expect(Number.isInteger(d)).toBe(true);
	});
});

describe("eloDelta — influence du K-factor", () => {
	test("K plus grand ⇒ variation (en valeur absolue) plus grande", () => {
		const d16 = eloDelta(1000, 1000, 1, 16);
		const d32 = eloDelta(1000, 1000, 1, 32);
		const d64 = eloDelta(1000, 1000, 1, 64);
		expect(Math.abs(d16)).toBeLessThan(Math.abs(d32));
		expect(Math.abs(d32)).toBeLessThan(Math.abs(d64));
	});

	test("K = 0 ⇒ aucune variation", () => {
		// Math.round peut produire -0 ; on teste la magnitude (|delta| = 0).
		expect(Math.abs(eloDelta(1000, 1500, 1, 0))).toBe(0);
		expect(Math.abs(eloDelta(1500, 1000, 0, 0))).toBe(0);
	});
});

describe("eloDelta — symétrie / conservation entre deux joueurs", () => {
	test("victoire/défaite à Elo égaux : somme des deltas = 0 (zéro-somme)", () => {
		const dGagnant = eloDelta(1000, 1000, 1, 32);
		const dPerdant = eloDelta(1000, 1000, 0, 32);
		expect(dGagnant + dPerdant).toBe(0);
	});

	test("le gain du gagnant ≈ la perte du perdant (à l'arrondi près)", () => {
		// Cas non symétrique : la conservation tient à ±1 point à cause de Math.round.
		const dGagnant = eloDelta(1000, 1325, 1, 32);
		const dPerdant = eloDelta(1325, 1000, 0, 32);
		expect(Math.abs(dGagnant + dPerdant)).toBeLessThanOrEqual(1);
	});
});

describe("applyEloUpdate — bornage du rating à 0", () => {
	test("application normale : newElo = elo + delta, clampedDelta = delta", () => {
		const { newElo, clampedDelta } = applyEloUpdate(1000, 16);
		expect(newElo).toBe(1016);
		expect(clampedDelta).toBe(16);
	});

	test("delta négatif réduit le rating", () => {
		const { newElo, clampedDelta } = applyEloUpdate(1000, -16);
		expect(newElo).toBe(984);
		expect(clampedDelta).toBe(-16);
	});

	test("clamp : un rating ne peut pas descendre sous 0", () => {
		const { newElo, clampedDelta } = applyEloUpdate(10, -50);
		expect(newElo).toBe(0);
		// Le delta réellement appliqué est ramené pour respecter le plancher.
		expect(clampedDelta).toBe(-10);
		expect(newElo).toBe(10 + clampedDelta);
	});

	test("clamp pile à 0 quand delta = -elo", () => {
		const { newElo, clampedDelta } = applyEloUpdate(25, -25);
		expect(newElo).toBe(0);
		expect(clampedDelta).toBe(-25);
	});

	test("delta nul ⇒ rating inchangé", () => {
		expect(applyEloUpdate(1000, 0)).toEqual({ newElo: 1000, clampedDelta: 0 });
	});

	test("invariant : newElo = elo + clampedDelta dans tous les cas", () => {
		for (const [elo, delta] of [
			[1000, 16],
			[1000, -16],
			[5, -100],
			[0, -10],
			[0, 30],
		]) {
			const { newElo, clampedDelta } = applyEloUpdate(elo, delta);
			expect(newElo).toBe(elo + clampedDelta);
			expect(newElo).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("computeMatchElo — duel gagnant / perdant (cœur EloService)", () => {
	test("Elo égaux : gagnant +16, perdant −16 (K par défaut)", () => {
		const r = computeMatchElo(1000, 1000);
		expect(r.newWinner).toBe(1016);
		expect(r.newLoser).toBe(984);
		expect(r.delta).toBe(16);
	});

	test("K-factor par défaut = 32, base rating par défaut = 0", () => {
		expect(DEFAULT_K_FACTOR).toBe(32);
		expect(DEFAULT_BASE_RATING).toBe(0);
	});

	test("le gagnant monte, le perdant descend (sens du delta)", () => {
		const r = computeMatchElo(1200, 900);
		expect(r.newWinner).toBeGreaterThan(1200);
		expect(r.newLoser).toBeLessThan(900);
		expect(r.delta).toBeGreaterThan(0);
	});

	test("upset : battre un favori rapporte plus que battre un outsider", () => {
		const upset = computeMatchElo(1000, 1600).delta;
		const attendu = computeMatchElo(1600, 1000).delta;
		expect(upset).toBeGreaterThan(attendu);
	});

	test("K-factor configurable de la saison répercuté sur le delta", () => {
		expect(computeMatchElo(1000, 1000, 16).delta).toBe(8);
		expect(computeMatchElo(1000, 1000, 64).delta).toBe(32);
	});

	test("conservation : à Elo égaux, points gagnés = points perdus", () => {
		const r = computeMatchElo(1000, 1000);
		expect(r.newWinner - 1000).toBe(1000 - r.newLoser);
	});

	test("clamp : le rating du perdant ne descend jamais sous 0", () => {
		// Perdant à 10 face à 20 : delta brut −16 ⇒ 10 - 16 = -6, borné à 0.
		const r = computeMatchElo(20, 10);
		expect(r.delta).toBe(16);
		expect(r.newLoser).toBeGreaterThanOrEqual(0);
		expect(r.newLoser).toBe(0);
	});

	test("résultats entiers (arrondis)", () => {
		const r = computeMatchElo(1337, 1042);
		expect(Number.isInteger(r.newWinner)).toBe(true);
		expect(Number.isInteger(r.newLoser)).toBe(true);
		expect(Number.isInteger(r.delta)).toBe(true);
	});
});

describe("peak_rating — suivi du plus haut Elo atteint (règle EloService)", () => {
	// EloService applique : `if (newWinner > peakRating) peakRating = newWinner`.
	// On reproduit cette règle pure de suivi du maximum.
	const trackPeak = (peak: number, newElo: number): number => Math.max(peak, newElo);

	test("une victoire qui pousse l'Elo au-dessus du pic met à jour le pic", () => {
		const r = computeMatchElo(1000, 1000); // newWinner = 1016 > 1000
		expect(trackPeak(1000, r.newWinner)).toBe(1016);
	});

	test("le pic ne régresse jamais après une baisse d'Elo (perdant)", () => {
		const peakAvant = 1500;
		const { newElo } = applyEloUpdate(1500, -16); // 1484 < pic
		expect(trackPeak(peakAvant, newElo)).toBe(1500);
	});

	test("le pic suit le nouvel Elo uniquement à la hausse (monotone)", () => {
		let peak = DEFAULT_BASE_RATING;
		let elo = DEFAULT_BASE_RATING;
		// Série de matchs : 2 victoires, 1 défaite, 1 victoire.
		for (const gagne of [true, false, false, true]) {
			const delta = eloDelta(elo, 1000, gagne ? 1 : 0, DEFAULT_K_FACTOR);
			elo = applyEloUpdate(elo, delta).newElo;
			peak = trackPeak(peak, elo);
		}
		// Le pic est >= l'Elo courant et >= la base, et n'a jamais baissé.
		expect(peak).toBeGreaterThanOrEqual(elo);
		expect(peak).toBeGreaterThanOrEqual(DEFAULT_BASE_RATING);
	});
});

describe("scores égaux / match nul", () => {
	test("nul à Elo égaux ⇒ aucun joueur ne bouge", () => {
		const dA = eloDelta(1100, 1100, 0.5, 32);
		const dB = eloDelta(1100, 1100, 0.5, 32);
		expect(dA).toBe(0);
		expect(dB).toBe(0);
	});

	test("nul avec écart d'Elo : le favori perd un peu, l'outsider gagne un peu", () => {
		const favori = eloDelta(1300, 1000, 0.5, 32);
		const outsider = eloDelta(1000, 1300, 0.5, 32);
		expect(favori).toBeLessThanOrEqual(0);
		expect(outsider).toBeGreaterThanOrEqual(0);
		// Zéro-somme à l'arrondi près.
		expect(Math.abs(favori + outsider)).toBeLessThanOrEqual(1);
	});
});
