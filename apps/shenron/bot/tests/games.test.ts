/**
 * Moteurs de jeux — morpion, pierre-feuille-ciseaux, bingo, pendu.
 *
 * Ce fichier ne s'exécutait PLUS DU TOUT : il importait `optimalMorpionMoves`,
 * `counterOf`, `bingoMaxAttempts` et un `BINGO_MAX_ATTEMPTS` par niveau, et
 * appelait `decideMorpionMove(b, "O", "hard")` / `decideBotChoice({ difficulty })`
 * / `randomPenduWord("hard")` — une notion de « difficulté » qui n'a jamais
 * existé dans ces modules. Bun échouait à charger le fichier (`SyntaxError` sur
 * l'import), donc les quatre suites étaient silencieusement absentes du total.
 *
 * Réécrit contre l'API réelle. L'IA du morpion n'est pas un minimax mais une
 * heuristique « gagner > bloquer > centre > coin > aléatoire » : c'est cette
 * priorité-là qui est vérifiée.
 */
import { describe, expect, test } from "bun:test";
import {
	MORPION_BOT,
	applyMorpionMove,
	createMorpionGame,
	decideMorpionMove,
	emptyBoard,
	evaluateBoard,
	hasActiveMorpionGame,
	morpionIdlePlayer,
	playMorpionTurn,
	type MorpionCell,
	type MorpionGame,
} from "../src/services/games/morpion";
import {
	DAY_MS,
	SingleUseTokens,
	SlidingWindowCounter,
	pairKey,
	rewardBlockReason,
	settleStakes,
	stakeAllowed,
} from "../src/services/games/anti-farm";
import {
	DIFFICULTY_WIN_MULTIPLIER,
	GAME_DIFFICULTIES,
	difficultyReward,
	parseGameDifficulty,
} from "../src/services/games/difficulty";
import { PFC_CHOICES, decideBotChoice, isPfcChoice, resolvePfc } from "../src/services/games/pfc";
import {
	BINGO_LEVELS,
	BINGO_MAX,
	BINGO_MAX_ATTEMPTS,
	BINGO_MIN,
	BINGO_MIN_TIME_MS,
	bingoLossPenalty,
	bingoOptimalWinChance,
	bingoReward,
	bingoTimeLimitMs,
	compareBingoGuess,
	narrowBingoRange,
	randomBingoTarget,
} from "../src/services/games/bingo";
import {
	PENDU_LEVELS,
	PENDU_MAX_ERRORS_CAP,
	PENDU_MAX_ERRORS_DEFAULT,
	PENDU_WORDS,
	PENDU_WORD_BANK,
	createPenduState,
	evaluatePendu,
	guessPenduLetter,
	guessPenduWord,
	maskPenduWord,
	normalizePenduWord,
	penduErrors,
	penduLivesLeft,
	penduMaxErrorsFor,
	penduReward,
	randomPenduEntry,
	randomPenduWord,
} from "../src/services/games/pendu";

function boardOf(s: string): MorpionCell[] {
	return s.split("") as MorpionCell[];
}

describe("morpion", () => {
	test("evaluateBoard détecte une ligne", () => {
		const o = evaluateBoard(boardOf("XXX......"));
		expect(o.kind).toBe("won");
		if (o.kind === "won") expect(o.mark).toBe("X");
	});

	test("evaluateBoard distingue partie en cours et match nul", () => {
		expect(evaluateBoard(emptyBoard()).kind).toBe("playing");
		// Grille pleine sans alignement.
		expect(evaluateBoard(boardOf("XXOOOXXOX")).kind).toBe("draw");
	});

	test("applyMorpionMove refuse une case occupée et les hors-bornes", () => {
		expect(applyMorpionMove(boardOf("X........"), 0, "O").ok).toBe(false);
		expect(applyMorpionMove(emptyBoard(), -1, "O").ok).toBe(false);
		expect(applyMorpionMove(emptyBoard(), 9, "O").ok).toBe(false);
	});

	test("applyMorpionMove ne mute pas la grille passée", () => {
		const avant = emptyBoard();
		const r = applyMorpionMove(avant, 4, "X");
		expect(r.ok).toBe(true);
		expect(avant[4]).toBe(".");
	});

	test("l'IA prend le gain immédiat", () => {
		expect(decideMorpionMove(boardOf("OO......."), "O")).toBe(2);
	});

	test("l'IA bloque le gain adverse", () => {
		expect(decideMorpionMove(boardOf("XX......."), "O")).toBe(2);
	});

	test("gagner passe avant bloquer", () => {
		// O peut gagner en 2 ; X menace en 5. L'IA doit conclure, pas défendre.
		expect(decideMorpionMove(boardOf("OO.XX...."), "O")).toBe(2);
	});

	test("sans menace, l'IA prend le centre puis un coin", () => {
		expect(decideMorpionMove(emptyBoard(), "O")).toBe(4);
		expect([0, 2, 6, 8]).toContain(decideMorpionMove(boardOf("....X...."), "O"));
	});

	test("une partie IA contre IA se termine toujours proprement", () => {
		for (let partie = 0; partie < 20; partie++) {
			let board = emptyBoard();
			let tour: "X" | "O" = "X";
			let coups = 0;
			while (evaluateBoard(board).kind === "playing" && coups < 9) {
				const r = applyMorpionMove(board, decideMorpionMove(board, tour), tour);
				expect(r.ok).toBe(true);
				if (!r.ok) break;
				board = r.board;
				tour = tour === "X" ? "O" : "X";
				coups++;
			}
			expect(["draw", "won"]).toContain(evaluateBoard(board).kind);
		}
	});
});

describe("pierre-feuille-ciseaux", () => {
	test("resolvePfc couvre le cycle complet", () => {
		expect(resolvePfc("pierre", "ciseaux")).toBe("win");
		expect(resolvePfc("ciseaux", "feuille")).toBe("win");
		expect(resolvePfc("feuille", "pierre")).toBe("win");
		expect(resolvePfc("pierre", "feuille")).toBe("lose");
		for (const c of PFC_CHOICES) expect(resolvePfc(c, c)).toBe("draw");
	});

	test("le bot ne joue que des coups valides, et les trois", () => {
		const vus = new Set<string>();
		for (let i = 0; i < 300; i++) {
			const c = decideBotChoice();
			expect(isPfcChoice(c)).toBe(true);
			vus.add(c);
		}
		// Tirage uniforme : les trois coups doivent apparaître sur 300 essais.
		expect(vus.size).toBe(3);
	});

	test("isPfcChoice rejette n'importe quoi", () => {
		expect(isPfcChoice("papier")).toBe(false);
		expect(isPfcChoice(null)).toBe(false);
		expect(isPfcChoice(42)).toBe(false);
	});
});

describe("bingo", () => {
	test("compareBingoGuess", () => {
		expect(compareBingoGuess(50, 50)).toBe("match");
		expect(compareBingoGuess(10, 50)).toBe("higher");
		expect(compareBingoGuess(90, 50)).toBe("lower");
	});

	test("les bornes sont cohérentes avec le tirage", () => {
		expect(BINGO_MIN).toBeLessThan(BINGO_MAX);
		for (let i = 0; i < 200; i++) {
			const t = randomBingoTarget();
			expect(t).toBeGreaterThanOrEqual(BINGO_MIN);
			expect(t).toBeLessThanOrEqual(BINGO_MAX);
			expect(Number.isInteger(t)).toBe(true);
		}
	});

	test("hors bornes et non-entiers sont rejetés", () => {
		expect(compareBingoGuess(BINGO_MIN - 1, 50)).toBe("out-of-range");
		expect(compareBingoGuess(BINGO_MAX + 1, 50)).toBe("out-of-range");
		expect(compareBingoGuess(12.5, 50)).toBe("out-of-range");
		expect(compareBingoGuess(Number.NaN, 50)).toBe("out-of-range");
	});

	test("le plafond d'essais est partagé avec l'API", () => {
		// `api/server.ts` compare `attempts >= BINGO_MAX_ATTEMPTS` : la valeur
		// vivait en dur des deux côtés avant d'être hissée dans ce module.
		expect(BINGO_MAX_ATTEMPTS).toBe(10);
	});
});

describe("pendu", () => {
	test("randomPenduWord renvoie un mot du dictionnaire", () => {
		const w = randomPenduWord();
		expect(w.length).toBeGreaterThan(2);
		expect(w).toBe(w.toLowerCase());
	});

	test("deviner toutes les lettres gagne la partie", () => {
		const s = createPenduState("goku", 4);
		for (const l of ["g", "o", "k", "u"]) {
			const r = guessPenduLetter(s, l);
			expect(r).toEqual({ hit: true, alreadyPlayed: false });
		}
		expect(evaluatePendu(s)).toBe("won");
		expect(maskPenduWord(s)).toBe("g o k u");
	});

	test("assez d'erreurs et la partie est perdue", () => {
		const s = createPenduState("goku", 3);
		for (const l of ["a", "b", "c"]) guessPenduLetter(s, l);
		expect(evaluatePendu(s)).toBe("lost");
	});

	test("rejouer une lettre ne consomme pas d'essai", () => {
		const s = createPenduState("goku", 3);
		guessPenduLetter(s, "a");
		expect(guessPenduLetter(s, "a")).toEqual({ hit: false, alreadyPlayed: true });
		expect(s.missed.size).toBe(1);
		expect(evaluatePendu(s)).toBe("playing");
	});

	test("une saisie qui n'est pas une lettre est ignorée", () => {
		const s = createPenduState("goku");
		expect(s.maxErrors).toBe(PENDU_MAX_ERRORS_DEFAULT);
		for (const saisie of ["1", "", "ab", "é", "-"]) {
			expect(guessPenduLetter(s, saisie)).toEqual({ hit: false, alreadyPlayed: true });
		}
		expect(s.missed.size).toBe(0);
	});

	test("le masque ne révèle que les lettres trouvées", () => {
		const s = createPenduState("goku", 6);
		guessPenduLetter(s, "o");
		expect(maskPenduWord(s)).toBe("_ o _ _");
		expect(maskPenduWord(s, "·")).toBe("· o · ·");
	});
});

// ─── Difficulté ─────────────────────────────────────────────────────────────

describe("difficulté", () => {
	test("les multiplicateurs de gain sont strictement croissants et jamais sous la base", () => {
		const m = GAME_DIFFICULTIES.map((l) => DIFFICULTY_WIN_MULTIPLIER[l]);
		expect(m[0]).toBe(1);
		for (let i = 1; i < m.length; i++) expect(m[i]!).toBeGreaterThan(m[i - 1]!);
	});

	test("gains par niveau sur la base de production (150)", () => {
		expect(difficultyReward(150, "facile")).toBe(150);
		expect(difficultyReward(150, "normal")).toBe(225);
		expect(difficultyReward(150, "difficile")).toBe(375);
		expect(difficultyReward(-10, "difficile")).toBe(0);
		expect(difficultyReward(Number.NaN, "normal")).toBe(0);
	});

	test("valeur inconnue → normal", () => {
		expect(parseGameDifficulty(undefined)).toBe("normal");
		expect(parseGameDifficulty("extrême")).toBe("normal");
		expect(parseGameDifficulty("difficile")).toBe("difficile");
	});
});

// ─── Pendu : paliers, vies, mots entiers ────────────────────────────────────

describe("pendu — difficulté", () => {
	test("dictionnaire normalisé, sans doublon entre paliers", () => {
		const seen = new Set<string>();
		for (const level of GAME_DIFFICULTIES) {
			expect(PENDU_WORD_BANK[level].length).toBeGreaterThanOrEqual(15);
			for (const { word } of PENDU_WORD_BANK[level]) {
				expect(word).toBe(normalizePenduWord(word));
				expect(word).toMatch(/^[a-z]+( [a-z]+)*$/);
				expect(seen.has(word)).toBe(false);
				seen.add(word);
			}
		}
		expect(PENDU_WORDS.length).toBe(seen.size);
	});

	test("facile : un seul mot, dix lettres au plus", () => {
		for (const { word } of PENDU_WORD_BANK.facile) {
			expect(word.includes(" ")).toBe(false);
			expect(word.length).toBeLessThanOrEqual(10);
		}
	});

	test("le tirage respecte le palier demandé, bornes du générateur comprises", () => {
		for (const level of GAME_DIFFICULTIES) {
			const pool = PENDU_WORD_BANK[level];
			expect(randomPenduEntry(level, () => 0)).toEqual(pool[0]!);
			expect(randomPenduEntry(level, () => 0.999999)).toEqual(pool[pool.length - 1]!);
			expect(pool.map((e) => e.word)).toContain(randomPenduWord(level));
		}
	});

	test("vies par niveau à partir du réglage (prod = 5, défaut = 6)", () => {
		expect(GAME_DIFFICULTIES.map((l) => penduMaxErrorsFor(l, 5))).toEqual([5, 4, 3]);
		expect(GAME_DIFFICULTIES.map((l) => penduMaxErrorsFor(l))).toEqual([6, 5, 4]);
		expect(GAME_DIFFICULTIES.map((l) => penduMaxErrorsFor(l, 3))).toEqual([3, 3, 3]);
		// Réglage au-delà des sept Dragon Balls : plafonné.
		expect(penduMaxErrorsFor("facile", 12)).toBe(PENDU_MAX_ERRORS_CAP);
	});

	test("les niveaux durcissent temps, pénalité de mot et indices", () => {
		const [f, n, d] = GAME_DIFFICULTIES.map((l) => PENDU_LEVELS[l]);
		expect(f!.timeLimitMs).toBeGreaterThan(n!.timeLimitMs);
		expect(n!.timeLimitMs).toBeGreaterThan(d!.timeLimitMs);
		expect(d!.wordMissCost).toBeGreaterThanOrEqual(n!.wordMissCost);
		expect(n!.wordMissCost).toBeGreaterThan(f!.wordMissCost);
		expect(d!.showCategory).toBe(false);
	});

	test("un mot entier faux coûte le prix du niveau et peut faire perdre", () => {
		const s = createPenduState("vegeta", 3);
		expect(guessPenduWord(s, "freezer", 2)).toEqual({ correct: false, cost: 2, ignored: false });
		expect(penduErrors(s)).toBe(2);
		expect(penduLivesLeft(s)).toBe(1);
		expect(s.missed.size).toBe(0);
		guessPenduLetter(s, "z");
		expect(evaluatePendu(s)).toBe("lost");
	});

	test("le mot entier juste gagne, accents et espaces ignorés", () => {
		const s = createPenduState("Kamé Sennin", 4);
		expect(s.word).toBe("kame sennin");
		expect(maskPenduWord(s)).toBe("_ _ _ _   _ _ _ _ _ _");
		expect(guessPenduWord(s, "KAMÉ-SENNIN", 2).correct).toBe(true);
		expect(evaluatePendu(s)).toBe("won");
	});

	test("une proposition trop courte n'est pas comptée", () => {
		const s = createPenduState("goku", 3);
		expect(guessPenduWord(s, "g", 2)).toEqual({ correct: false, cost: 0, ignored: true });
		expect(penduErrors(s)).toBe(0);
	});

	test("les espaces sont révélés d'office : trouver toutes les lettres suffit", () => {
		const s = createPenduState("tao pai pai", 5);
		for (const l of "taopi") guessPenduLetter(s, l);
		expect(evaluatePendu(s)).toBe("won");
	});

	test("gain du pendu par niveau", () => {
		expect(GAME_DIFFICULTIES.map((l) => penduReward(150, l))).toEqual([150, 225, 375]);
	});
});

// ─── Bingo : courbe de difficulté ──────────────────────────────────────────

describe("bingo — difficulté", () => {
	test("plages croissantes, chances optimales décroissantes", () => {
		const chances = GAME_DIFFICULTIES.map(bingoOptimalWinChance);
		expect(chances[0]).toBe(1);
		expect(chances[1]!).toBeLessThan(1);
		expect(chances[2]!).toBeLessThan(chances[1]!);
		expect(BINGO_LEVELS.normal.max).toBeGreaterThan(BINGO_LEVELS.facile.max);
		expect(BINGO_LEVELS.difficile.max).toBeGreaterThan(BINGO_LEVELS.normal.max);
	});

	test("la partie web garde le niveau facile (contrat du site)", () => {
		expect(BINGO_LEVELS.facile.min).toBe(BINGO_MIN);
		expect(BINGO_LEVELS.facile.max).toBe(BINGO_MAX);
		expect(BINGO_LEVELS.facile.maxAttempts).toBe(BINGO_MAX_ATTEMPTS);
	});

	test("durée dérivée de game.bingo.limit_ms (prod = 25 s)", () => {
		expect(GAME_DIFFICULTIES.map((l) => bingoTimeLimitMs(l, 25_000))).toEqual([40_000, 40_000, 50_000]);
		expect(bingoTimeLimitMs("facile", 1_000)).toBe(BINGO_MIN_TIME_MS);
		expect(bingoTimeLimitMs("normal", Number.NaN)).toBeGreaterThanOrEqual(BINGO_MIN_TIME_MS);
	});

	test("comparaison et tirage sur une plage personnalisée", () => {
		const { min, max } = BINGO_LEVELS.difficile;
		expect(compareBingoGuess(999, 500, min, max)).toBe("lower");
		expect(compareBingoGuess(1001, 500, min, max)).toBe("out-of-range");
		expect(randomBingoTarget(min, max, () => 0)).toBe(min);
		expect(randomBingoTarget(min, max, () => 0.9999999)).toBe(max);
	});

	test("l'intervalle possible se resserre sans jamais s'élargir", () => {
		let r = { lo: 1, hi: 1000 };
		r = narrowBingoRange(r, 500, "higher");
		expect(r).toEqual({ lo: 501, hi: 1000 });
		r = narrowBingoRange(r, 750, "lower");
		expect(r).toEqual({ lo: 501, hi: 749 });
		// Un essai hors de l'intervalle déjà connu n'élargit rien.
		expect(narrowBingoRange(r, 100, "higher")).toEqual({ lo: 501, hi: 749 });
		expect(narrowBingoRange(r, 600, "match")).toEqual({ lo: 600, hi: 600 });
	});

	test("gains et pénalités par niveau", () => {
		expect(GAME_DIFFICULTIES.map((l) => bingoReward(150, l))).toEqual([150, 225, 375]);
		expect(GAME_DIFFICULTIES.map((l) => bingoLossPenalty(50, l))).toEqual([0, 50, 50]);
	});
});

// ─── Morpion : failles de farm corrigées ────────────────────────────────────

function playAll(game: MorpionGame, userId: string, cells: number[]) {
	let last: ReturnType<typeof playMorpionTurn> | null = null;
	for (const c of cells) {
		last = playMorpionTurn(game, userId, c);
		if (!last.ok || last.outcome.kind !== "playing") break;
	}
	return last;
}

describe("morpion — anti-farm", () => {
	test("faille 1 : la séquence farmée 6,2,8,5 ne bat plus le robot", () => {
		// Relevée 161 fois sur 170 parties solo en production (ouverture coins opposés).
		for (const seq of [
			[6, 2, 8, 5],
			[0, 8, 6, 3],
			[2, 6, 0, 1],
		]) {
			const g = createMorpionGame("u1", MORPION_BOT);
			const free = () => g.board.map((c, i) => (c === "." ? i : -1)).filter((i) => i >= 0);
			for (const wanted of seq) {
				if (g.status !== "playing") break;
				const cell = g.board[wanted] === "." ? wanted : free()[0]!;
				playMorpionTurn(g, "u1", cell);
			}
			const o = evaluateBoard(g.board);
			expect(o.kind === "won" && o.mark === "X").toBe(false);
		}
	});

	test("faille 1 : le robot sans erreur ne perd contre aucune stratégie (arbre complet)", () => {
		let games = 0;
		const explore = (board: MorpionCell[]) => {
			for (let i = 0; i < 9; i++) {
				if (board[i] !== ".") continue;
				const g: MorpionGame = {
					board: board.slice(),
					turn: "X",
					playerX: "u1",
					playerO: MORPION_BOT,
					stake: 0,
					status: "playing",
				};
				const r = playMorpionTurn(g, "u1", i);
				expect(r.ok).toBe(true);
				if (!r.ok) continue;
				if (r.outcome.kind === "playing") explore(g.board);
				else {
					games++;
					expect(r.outcome.kind === "won" && r.outcome.mark === "X").toBe(false);
				}
			}
		};
		explore(emptyBoard());
		expect(games).toBeGreaterThan(100);
	});

	test("faille 1 : avec erreurs aléatoires, le robot reste battable", () => {
		const g = createMorpionGame("u1", MORPION_BOT);
		// Erreur forcée : le robot joue la première case libre au lieu d'un coin.
		const r = playMorpionTurn(g, "u1", 4, { blunderChance: 1, rng: () => 0 });
		expect(r.ok && r.botCell).toBe(0);
	});

	test("faille 2 : un second clic après la fin ne rejoue pas (double paiement)", () => {
		const g = createMorpionGame("x", "o");
		const moves: Array<[string, number]> = [
			["x", 0],
			["o", 3],
			["x", 1],
			["o", 4],
		];
		for (const [u, c] of moves) expect(playMorpionTurn(g, u, c).ok).toBe(true);
		const win = playMorpionTurn(g, "x", 2);
		expect(win.ok && win.outcome.kind).toBe("won");
		expect(g.status).toBe("finished");
		// Double-clic, clic concurrent de l'adversaire, bouton resté actif.
		expect(playMorpionTurn(g, "x", 5)).toEqual({ ok: false, reason: "finished" });
		expect(playMorpionTurn(g, "o", 5)).toEqual({ ok: false, reason: "finished" });
	});

	test("faille 3 : le tour du robot n'est jouable par personne, un spectateur jamais", () => {
		const g = createMorpionGame("u1", MORPION_BOT);
		g.turn = "O";
		expect(playMorpionTurn(g, "u1", 0)).toEqual({ ok: false, reason: "not-your-turn" });
		expect(playMorpionTurn(g, "intrus", 0)).toEqual({ ok: false, reason: "not-your-turn" });
		const duel = createMorpionGame("x", "o");
		expect(playMorpionTurn(duel, "intrus", 0)).toEqual({ ok: false, reason: "not-your-turn" });
		expect(playMorpionTurn(duel, "o", 0)).toEqual({ ok: false, reason: "not-your-turn" });
	});

	test("faille 4 : mises refusées contre le robot, acceptées en duel", () => {
		expect(stakeAllowed("bot", 1_000_000)).toBe(false);
		expect(stakeAllowed("bot", undefined)).toBe(true);
		expect(stakeAllowed("joueur", 1_000_000)).toBe(true);
	});

	test("faille 5 : mises séquestrées, règlement à somme nulle", () => {
		for (const kind of ["win", "draw", "forfeit", "cancel"] as const) {
			const { winner, loser } = settleStakes(kind, 1_000);
			expect(winner + loser).toBe(2_000);
		}
		expect(settleStakes("win", 1_000)).toEqual({ winner: 2_000, loser: 0 });
		expect(settleStakes("draw", 1_000)).toEqual({ winner: 1_000, loser: 1_000 });
	});

	test("faille 6 : abandon — le joueur dont c'est le tour déclare forfait", () => {
		const g = createMorpionGame("x", "o", 500);
		expect(morpionIdlePlayer(g)).toBe("x");
		playMorpionTurn(g, "x", 4);
		expect(morpionIdlePlayer(g)).toBe("o");
		expect(morpionIdlePlayer(createMorpionGame("x", MORPION_BOT))).toBe("x");
	});

	test("faille 7 : une seule partie active par joueur (plus de plateaux parallèles)", () => {
		const a = createMorpionGame("u1", MORPION_BOT);
		const b = createMorpionGame("u2", "u3");
		expect(hasActiveMorpionGame([a, b], "u1")).toBe(true);
		expect(hasActiveMorpionGame([a, b], "u3")).toBe(true);
		expect(hasActiveMorpionGame([a, b], "u4")).toBe(false);
		a.status = "finished";
		expect(hasActiveMorpionGame([a, b], "u1")).toBe(false);
	});

	test("faille 8 : collusion — plafond par paire et plafond quotidien", () => {
		expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
		const counter = new SlidingWindowCounter(DAY_MS);
		const key = pairKey("main", "alt");
		const t0 = 1_000_000;
		for (let i = 0; i < 3; i++) {
			expect(rewardBlockReason({ dailyCount: i, dailyCap: 20, pairCount: counter.count(key, t0), pairCap: 3 })).toBeNull();
			counter.record(key, t0 + i);
		}
		expect(rewardBlockReason({ dailyCount: 3, dailyCap: 20, pairCount: counter.count(key, t0 + 10), pairCap: 3 })).toBe("pair-cap");
		// Fenêtre glissante : 24 h plus tard la paire est de nouveau récompensée.
		expect(counter.count(key, t0 + DAY_MS + 10)).toBe(0);
		expect(rewardBlockReason({ dailyCount: 20, dailyCap: 20 })).toBe("daily-cap");
	});

	test("faille 9 : un état signé de l'API web ne se rejoue pas", () => {
		const tokens = new SingleUseTokens();
		expect(tokens.consume("morpion:sig", 1_000, 0)).toBe(true);
		expect(tokens.consume("morpion:sig", 1_000, 500)).toBe(false);
		// Après expiration, la signature est de toute façon refusée par l'horodatage.
		expect(tokens.consume("morpion:sig", 1_000, 1_001)).toBe(true);
		expect(tokens.size).toBe(1);
	});
});
