/**
 * Tests unitaires — logique PURE de résolution d'un match ranked
 * (`@rosegriffon/achillea-core/ranked`).
 *
 * Aucune DB / Colyseus / Discord : on couvre la machine de décision de la fin de match
 * ASYNCHRONE (chaque joueur saisit indépendamment), l'assignation domicile/extérieur,
 * la double-validation (accord symétrique), le forfait au timeout, et la mise en litige.
 */

import { describe, expect, test } from "bun:test";

import {
	clampScore,
	eloWindow,
	isHomeTeam,
	parseMode,
	resolveScores,
	resultLabel,
	scoresAgree,
	selectQueuePair,
	teamForIndex,
	type QueueCandidate,
	type ScoreInput,
	TeamSide,
} from "@rosegriffon/achillea-core";

// Fabrique une saisie joueur (du point de vue du joueur).
function input(userId: string, myScore: number, oppScore: number, submitted = true): ScoreInput {
	return { userId, myScore, oppScore, submitted };
}

describe("teamForIndex — domicile (1er) / extérieur (2e)", () => {
	test("index 0 → domicile (TEAM_1)", () => {
		expect(teamForIndex(0)).toBe(TeamSide.TEAM_1);
		expect(teamForIndex(0)).toBe(1);
	});

	test("index 1 → extérieur (TEAM_2)", () => {
		expect(teamForIndex(1)).toBe(TeamSide.TEAM_2);
		expect(teamForIndex(1)).toBe(2);
	});

	test("tout index ≠ 0 retombe sur extérieur (défensif)", () => {
		expect(teamForIndex(2)).toBe(TeamSide.TEAM_2);
		expect(teamForIndex(-1)).toBe(TeamSide.TEAM_2);
	});
});

describe("isHomeTeam", () => {
	test("team 1 = domicile", () => {
		expect(isHomeTeam(TeamSide.TEAM_1)).toBe(true);
		expect(isHomeTeam(1)).toBe(true);
	});

	test("team 2 / 0 ≠ domicile", () => {
		expect(isHomeTeam(TeamSide.TEAM_2)).toBe(false);
		expect(isHomeTeam(0)).toBe(false);
	});
});

describe("clampScore — bornage [0..99] entier", () => {
	test("valeurs normales conservées", () => {
		expect(clampScore(0)).toBe(0);
		expect(clampScore(3)).toBe(3);
		expect(clampScore(99)).toBe(99);
	});

	test("borne basse : négatif → 0", () => {
		expect(clampScore(-1)).toBe(0);
		expect(clampScore(-1000)).toBe(0);
	});

	test("borne haute : > 99 → 99", () => {
		expect(clampScore(100)).toBe(99);
		expect(clampScore(5000)).toBe(99);
	});

	test("plancher des décimales (Math.floor)", () => {
		expect(clampScore(3.9)).toBe(3);
		expect(clampScore(2.1)).toBe(2);
	});

	test("entrées invalides → 0", () => {
		expect(clampScore(null)).toBe(0);
		expect(clampScore(undefined)).toBe(0);
		expect(clampScore(NaN)).toBe(0);
		expect(clampScore("abc")).toBe(0);
	});

	test("chaîne numérique tolérée", () => {
		expect(clampScore("7")).toBe(7);
		expect(clampScore("150")).toBe(99);
	});
});

describe("scoresAgree — concordance des 2 scorelines", () => {
	test("accord symétrique : domicile 3-1 ⇄ extérieur 1-3", () => {
		expect(scoresAgree(input("H", 3, 1), input("A", 1, 3))).toBe(true);
	});

	test("accord sur un match nul", () => {
		expect(scoresAgree(input("H", 2, 2), input("A", 2, 2))).toBe(true);
	});

	test("désaccord : les buts ne se croisent pas", () => {
		expect(scoresAgree(input("H", 3, 1), input("A", 2, 3))).toBe(false);
	});

	test("désaccord : les deux se déclarent vainqueurs", () => {
		expect(scoresAgree(input("H", 3, 1), input("A", 3, 1))).toBe(false);
	});

	test("pas d'accord si un joueur n'a pas saisi", () => {
		expect(scoresAgree(input("H", 3, 1), input("A", 1, 3, false))).toBe(false);
		expect(scoresAgree(input("H", 3, 1, false), input("A", 1, 3))).toBe(false);
	});
});

describe("resultLabel — issue du point de vue d'un joueur", () => {
	test("victoire / défaite / nul", () => {
		expect(resultLabel(3, 1)).toBe("win");
		expect(resultLabel(1, 3)).toBe("loss");
		expect(resultLabel(2, 2)).toBe("draw");
		expect(resultLabel(0, 0)).toBe("draw");
	});
});

describe("resolveScores — machine de décision asynchrone", () => {
	test("attend tant que les 2 n'ont pas saisi (hors timeout)", () => {
		expect(resolveScores(input("H", 3, 1), input("A", 0, 0, false), false)).toEqual({
			kind: "wait",
		});
		expect(resolveScores(input("H", 0, 0, false), input("A", 1, 3), false)).toEqual({
			kind: "wait",
		});
		expect(resolveScores(input("H", 0, 0, false), input("A", 0, 0, false), false)).toEqual({
			kind: "wait",
		});
	});

	test("accord → finalisation avec scores côté domicile/extérieur (s1/s2)", () => {
		const out = resolveScores(input("H", 3, 1), input("A", 1, 3), false);
		expect(out).toEqual({ kind: "agree", s1: 3, s2: 1 });
	});

	test("accord sur un nul", () => {
		const out = resolveScores(input("H", 2, 2), input("A", 2, 2), false);
		expect(out).toEqual({ kind: "agree", s1: 2, s2: 2 });
	});

	test("désaccord (les 2 ont saisi) → litige", () => {
		const out = resolveScores(input("H", 3, 1), input("A", 3, 1), false);
		expect(out).toEqual({ kind: "dispute" });
	});

	test("timeout : seul le domicile a saisi → extérieur forfait", () => {
		const out = resolveScores(input("H", 5, 0), input("A", 0, 0, false), true);
		expect(out).toEqual({ kind: "forfeit", s1: 5, s2: 0, forfeitUserId: "A" });
	});

	test("timeout : seul l'extérieur a saisi → domicile forfait (scores remappés)", () => {
		// L'extérieur déclare 4 buts pour lui (myScore) et 0 pour le domicile (oppScore).
		const out = resolveScores(input("H", 0, 0, false), input("A", 4, 0), true);
		expect(out).toEqual({ kind: "forfeit", s1: 0, s2: 4, forfeitUserId: "H" });
	});

	test("timeout : personne n'a saisi → litige", () => {
		const out = resolveScores(input("H", 0, 0, false), input("A", 0, 0, false), true);
		expect(out).toEqual({ kind: "dispute" });
	});

	test("timeout : les 2 ont saisi mais en désaccord → litige (pas de forfait)", () => {
		const out = resolveScores(input("H", 3, 1), input("A", 2, 1), true);
		expect(out).toEqual({ kind: "dispute" });
	});

	test("timeout : les 2 ont saisi et concordent → accord (même au forçage)", () => {
		const out = resolveScores(input("H", 1, 0), input("A", 0, 1), true);
		expect(out).toEqual({ kind: "agree", s1: 1, s2: 0 });
	});

	test("le forfait nomme toujours le joueur absent, jamais le saisissant", () => {
		const homeForfait = resolveScores(input("H", 0, 0, false), input("A", 2, 0), true);
		const awayForfait = resolveScores(input("H", 2, 0), input("A", 0, 0, false), true);
		if (homeForfait.kind !== "forfeit" || awayForfait.kind !== "forfeit") {
			throw new Error("attendu : forfait");
		}
		expect(homeForfait.forfeitUserId).toBe("H");
		expect(awayForfait.forfeitUserId).toBe("A");
	});

	test("parseMode : normalise un mode arbitraire vers 2 ou 4", () => {
		expect(parseMode(4)).toBe(4);
		expect(parseMode("4")).toBe(4);
		expect(parseMode(2)).toBe(2);
		expect(parseMode(0)).toBe(2);
		expect(parseMode(999)).toBe(2);
		expect(parseMode(undefined)).toBe(2);
		expect(parseMode("xyz")).toBe(2);
	});
});

describe("eloWindow — fenêtre dynamique d'appariement", () => {
	test("pas d'élargissement avant 5 s", () => {
		expect(eloWindow(200, 0)).toBe(200);
		expect(eloWindow(200, 4999)).toBe(200);
	});

	test("+50 AP par tranche de 5 s", () => {
		expect(eloWindow(200, 5000)).toBe(250);
		expect(eloWindow(200, 10_000)).toBe(300);
		expect(eloWindow(200, 32_000)).toBe(500); // 6 tranches
	});

	test("attente négative (horloge) → fenêtre de base", () => {
		expect(eloWindow(200, -1000)).toBe(200);
	});
});

describe("selectQueuePair — appariement file (anti auto-appariement)", () => {
	const c = (userId: string, elo: number, enqueuedAt = 0): QueueCandidate => ({
		userId,
		elo,
		enqueuedAt,
	});

	test("apparie 2 joueurs dans la fenêtre", () => {
		const list = [c("A", 1000), c("B", 1100)];
		expect(selectQueuePair(list, 0, 200)).toEqual([0, 1]);
	});

	test("RÉGRESSION : ne s'apparie JAMAIS contre soi-même (multi-onglets)", () => {
		// Même userId, même elo → adjacents au tri. La paire DOIT être refusée.
		const list = [c("A", 1000, 0), c("A", 1000, 0)];
		expect(selectQueuePair(list, 0, 200)).toBeNull();
	});

	test("saute le doublon de soi et apparie avec un autre joueur", () => {
		// Liste triée : A(1000), A(1000), B(1050). A ne peut pas jouer contre A → A vs B.
		const list = [c("A", 1000), c("A", 1000), c("B", 1050)];
		expect(selectQueuePair(list, 0, 200)).toEqual([0, 2]);
	});

	test("hors fenêtre → aucune paire (élos trop éloignés, attente nulle)", () => {
		const list = [c("A", 1000), c("B", 1500)];
		expect(selectQueuePair(list, 0, 200)).toBeNull();
	});

	test("la fenêtre s'élargit avec l'attente → apparie après un long délai", () => {
		// Écart de 500 ; à t=0 hors fenêtre (200), mais enquêtés depuis 35 s → fenêtre 550.
		const list = [c("A", 1000, 0), c("B", 1500, 0)];
		expect(selectQueuePair(list, 35_000, 200)).toEqual([0, 1]);
	});

	test("choisit la 1re paire valide (élos proches) et ignore les trop éloignés", () => {
		const list = [c("A", 1000), c("B", 1400), c("C", 1450)];
		// A hors fenêtre de B et C ; B-C dans la fenêtre → [1, 2].
		expect(selectQueuePair(list, 0, 200)).toEqual([1, 2]);
	});

	test("file vide ou singleton → null", () => {
		expect(selectQueuePair([], 0, 200)).toBeNull();
		expect(selectQueuePair([c("A", 1000)], 0, 200)).toBeNull();
	});
});
