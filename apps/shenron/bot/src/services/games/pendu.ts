/**
 * Pendu — logique pure, sans dépendance Discord.
 * Source de vérité partagée par /pendu (Discord) et `POST /api/games/pendu/*`.
 *
 * Vocabulaire Dragon Ball réparti en trois paliers. Les graphies suivent les
 * fiches du wiki (`db_characters`, `db_techniques`, `db_planets`, `db_races`),
 * sans accents ni tirets pour rester jouables au clavier (a-z).
 */
import { difficultyReward, type GameDifficulty } from "./difficulty";

type PenduCategory = "Personnage" | "Technique" | "Lieu" | "Objet" | "Race" | "Transformation";

export interface PenduEntry {
	word: string;
	category: PenduCategory;
}

const P = "Personnage" as const;
const T = "Technique" as const;
const L = "Lieu" as const;
const O = "Objet" as const;
const R = "Race" as const;
const TR = "Transformation" as const;

function entries(category: PenduCategory, words: readonly string[]): PenduEntry[] {
	return words.map((word) => ({ word, category }));
}

/**
 * Facile : noms que tout lecteur connaît, un seul mot.
 * Normal : second cercle (antagonistes, fusions, techniques secondaires).
 * Difficile : personnages rares, noms courts à lettres peu fréquentes, termes composés.
 */
export const PENDU_WORD_BANK: Record<GameDifficulty, readonly PenduEntry[]> = {
	facile: [
		...entries(P, [
			"goku",
			"vegeta",
			"gohan",
			"piccolo",
			"krillin",
			"bulma",
			"chichi",
			"trunks",
			"goten",
			"freezer",
			"cell",
			"broly",
			"videl",
			"beerus",
			"whis",
			"shenron",
		]),
		...entries(T, ["kamehameha", "genkidama"]),
		...entries(L, ["namek", "terre"]),
		...entries(O, ["senzu", "capsule", "radar"]),
		...entries(R, ["saiyan"]),
	],
	normal: [
		...entries(P, [
			"tenshinhan",
			"yamcha",
			"bardock",
			"raditz",
			"nappa",
			"ginyu",
			"zarbon",
			"dodoria",
			"gotenks",
			"vegetto",
			"gogeta",
			"dende",
			"babidi",
			"cooler",
			"jiren",
			"zamasu",
			"cabba",
			"karin",
			"pilaf",
			"majin boo",
		]),
		...entries(T, ["masenko", "kienzan", "kaioken", "kikoho"]),
		...entries(L, ["yardrat", "kanassa"]),
		...entries(O, ["potara"]),
		...entries(R, ["metamoran"]),
		...entries(TR, ["super saiyan"]),
	],
	difficile: [
		...entries(P, [
			"spopovitch",
			"hatchiyack",
			"janemba",
			"tapion",
			"ribrianne",
			"dyspo",
			"quitela",
			"sidra",
			"mojito",
			"glorio",
			"degesu",
			"zangya",
			"botamo",
			"tambourine",
			"yakon",
			"oolong",
			"bibidi",
			"dabra",
			"champa",
			"vados",
			"caulifla",
			"toppo",
			"moro",
			"frost",
			"kame sennin",
			"tao pai pai",
		]),
		...entries(T, ["makankosappo"]),
		...entries(L, ["monmar", "etoile makyo"]),
		...entries(R, ["cerealien", "yardratien"]),
		...entries(TR, ["ultra instinct"]),
	],
};

/** Tous les mots, tous niveaux confondus (compatibilité). */
export const PENDU_WORDS: readonly string[] = Object.values(PENDU_WORD_BANK).flatMap((tier) =>
	tier.map((e) => e.word)
);

export const PENDU_MAX_ERRORS_DEFAULT = 6;
const PENDU_MIN_ERRORS = 3;
/** Plafond : une vie = une Dragon Ball, il n'y en a que sept. */
export const PENDU_MAX_ERRORS_CAP = 7;

export interface PenduLevel {
	/** Vies retirées par rapport au réglage `game.pendu.max_errors`. */
	lifeOffset: number;
	/** Durée d'une partie solo. */
	timeLimitMs: number;
	/** Vies perdues quand un mot entier proposé est faux. */
	wordMissCost: number;
	/** La catégorie du mot (personnage, technique…) est-elle donnée ? */
	showCategory: boolean;
}

export const PENDU_LEVELS: Record<GameDifficulty, PenduLevel> = {
	facile: { lifeOffset: 0, timeLimitMs: 90_000, wordMissCost: 1, showCategory: true },
	normal: { lifeOffset: 1, timeLimitMs: 75_000, wordMissCost: 2, showCategory: true },
	difficile: { lifeOffset: 2, timeLimitMs: 60_000, wordMissCost: 2, showCategory: false },
};

/** Vies disponibles au niveau donné, à partir du réglage de base. */
export function penduMaxErrorsFor(
	level: GameDifficulty,
	base: number = PENDU_MAX_ERRORS_DEFAULT
): number {
	const safeBase = Number.isFinite(base) ? Math.trunc(base) : PENDU_MAX_ERRORS_DEFAULT;
	const clamped = Math.max(PENDU_MIN_ERRORS, Math.min(PENDU_MAX_ERRORS_CAP, safeBase));
	return Math.max(PENDU_MIN_ERRORS, clamped - PENDU_LEVELS[level].lifeOffset);
}

/** Gain d'une victoire au pendu (hors mise). */
export function penduReward(baseWin: number, level: GameDifficulty): number {
	return difficultyReward(baseWin, level);
}

const PENDU_HANGMAN_FRAMES = [
	"        \n        \n        \n        \n        \n========",
	"  +---+\n  |   |\n      |\n      |\n      |\n========",
	"  +---+\n  |   |\n  O   |\n      |\n      |\n========",
	"  +---+\n  |   |\n  O   |\n  |   |\n      |\n========",
	"  +---+\n  |   |\n  O   |\n /|   |\n      |\n========",
	"  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n========",
	"  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n========",
] as const;

export type PenduState = {
	word: string;
	found: Set<string>;
	missed: Set<string>;
	/** Vies perdues hors lettres (mots entiers faux). */
	extraErrors: number;
	maxErrors: number;
};

/** Minuscules, sans accents ; tirets et apostrophes deviennent des espaces. */
export function normalizePenduWord(raw: string): string {
	return raw
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[-'\u2019]/g, " ")
		.replace(/[^a-z ]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function lettersOnly(s: string): string {
	return s.replace(/[^a-z]/g, "");
}

function isPenduLetter(c: string): boolean {
	return /^[a-z]$/.test(c);
}

/** Tire une entrée du palier demandé (ou de tout le dictionnaire sans palier). */
export function randomPenduEntry(level?: GameDifficulty, rng: () => number = Math.random): PenduEntry {
	const pool = level ? PENDU_WORD_BANK[level] : Object.values(PENDU_WORD_BANK).flat();
	const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
	return pool[idx]!;
}

export function randomPenduWord(level?: GameDifficulty, rng: () => number = Math.random): string {
	return randomPenduEntry(level, rng).word;
}

export function createPenduState(word: string, maxErrors = PENDU_MAX_ERRORS_DEFAULT): PenduState {
	return {
		word: normalizePenduWord(word),
		found: new Set(),
		missed: new Set(),
		extraErrors: 0,
		maxErrors: Math.max(PENDU_MIN_ERRORS, Math.min(PENDU_MAX_ERRORS_CAP, maxErrors)),
	};
}

/** Vies perdues : lettres ratées + pénalités de mots faux. */
export function penduErrors(state: PenduState): number {
	return state.missed.size + state.extraErrors;
}

export function penduLivesLeft(state: PenduState): number {
	return Math.max(0, state.maxErrors - penduErrors(state));
}

export type PenduOutcome = "playing" | "won" | "lost";

export function evaluatePendu(state: PenduState): PenduOutcome {
	if ([...lettersOnly(state.word)].every((c) => state.found.has(c))) return "won";
	if (penduErrors(state) >= state.maxErrors) return "lost";
	return "playing";
}

/**
 * Joue une lettre. Retourne `{hit, alreadyPlayed}`. Mute state in place.
 * Toute saisie qui n'est pas une lettre a-z unique est ignorée.
 */
export function guessPenduLetter(
	state: PenduState,
	letter: string
): { hit: boolean; alreadyPlayed: boolean } {
	const l = letter.toLowerCase();
	if (!isPenduLetter(l)) {
		return { hit: false, alreadyPlayed: true };
	}
	if (state.found.has(l) || state.missed.has(l)) {
		return { hit: false, alreadyPlayed: true };
	}
	if (state.word.includes(l)) {
		state.found.add(l);
		return { hit: true, alreadyPlayed: false };
	}
	state.missed.add(l);
	return { hit: false, alreadyPlayed: false };
}

/**
 * Tente le mot entier (espaces et accents ignorés). Un mot faux coûte `cost`
 * vies ; une saisie de moins de deux lettres est ignorée. Mute state in place.
 */
export function guessPenduWord(
	state: PenduState,
	guess: string,
	cost = 1
): { correct: boolean; cost: number; ignored: boolean } {
	const attempt = lettersOnly(normalizePenduWord(guess));
	if (attempt.length < 2) return { correct: false, cost: 0, ignored: true };
	if (attempt === lettersOnly(state.word)) {
		for (const c of attempt) state.found.add(c);
		return { correct: true, cost: 0, ignored: false };
	}
	const penalty = Math.max(1, Math.trunc(cost));
	state.extraErrors += penalty;
	return { correct: false, cost: penalty, ignored: false };
}

/** Mot affiché avec `hidden` pour les lettres non devinées ; les espaces restent visibles. */
export function maskPenduWord(state: PenduState, hidden = "_"): string {
	return [...state.word]
		.map((c) => (!isPenduLetter(c) ? c : state.found.has(c) ? c : hidden))
		.join(" ");
}

/** ASCII frame courant (API historique). */
function penduFrame(state: PenduState): string {
	const idx = Math.min(penduErrors(state), PENDU_HANGMAN_FRAMES.length - 1);
	return PENDU_HANGMAN_FRAMES[idx]!;
}
