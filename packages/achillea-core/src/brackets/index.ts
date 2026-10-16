/**
 * Arithmétique de bracket — taille, tours, exempts, nombre de manches.
 *
 * Volontairement indépendant de `brackets-manager` : ce sont les règles dont
 * une UI (ou un moteur de jeu) a besoin pour dimensionner un arbre, prévoir un
 * planning ou afficher une progression, sans embarquer le moteur complet.
 */

import { MatchFormat, StageType } from "@rosegriffon/achillea-types";

import { toCount, toPositiveInt } from "../numbers/index";

/**
 * Formats proposés à la création d'un tournoi.
 *
 * `StageType` étend `BracketsStageType` du championnat Achilléa (`league`),
 * qui n'existe pas dans `brackets-model` : calendrier + classement par points,
 * pas d'arbre.
 */
export const ALL_STAGE_TYPES: readonly StageType[] = [
	StageType.round_robin,
	StageType.single_elimination,
	StageType.double_elimination,
	StageType.league,
] as const;

/** Formats à arbre, seuls gérés par `brackets-manager`. */
export const BRACKET_STAGE_TYPES: readonly StageType[] = [
	StageType.single_elimination,
	StageType.double_elimination,
] as const;

/** `true` si le format se joue en arbre (et non en calendrier / poule). */
export function isBracketStageType(type: StageType | string): boolean {
	return (BRACKET_STAGE_TYPES as readonly string[]).includes(type);
}

/** Puissance de 2 immédiatement supérieure ou égale (minimum 1). */
export function nextPowerOfTwo(size: number): number {
	return 2 ** Math.ceil(Math.log2(toPositiveInt(size)));
}

/** `true` si `size` est exactement une puissance de 2. */
export function isPowerOfTwo(size: number): boolean {
	return Number.isInteger(size) && size > 0 && (size & (size - 1)) === 0;
}

/** Nombre d'exempts (byes) au premier tour pour `participants` inscrits. */
export function byeCount(participants: number): number {
	const n = toCount(participants);
	if (n <= 1) return 0;
	return nextPowerOfTwo(n) - n;
}

/** Nombre de tours d'un arbre à élimination simple. */
export function singleEliminationRounds(participants: number): number {
	const n = toCount(participants);
	if (n <= 1) return 0;
	return Math.ceil(Math.log2(n));
}

/**
 * Nombre de tours d'une double élimination, grande finale comprise.
 * Winner bracket : `r` tours. Loser bracket : `2r − 1`. Grande finale : 1.
 */
export function doubleEliminationRounds(participants: number): number {
	const r = singleEliminationRounds(participants);
	if (r === 0) return 0;
	return 2 * r;
}

/** Nombre de journées d'un round robin (algorithme du cercle). */
export function roundRobinRounds(participants: number, doubleLegged = false): number {
	const n = toCount(participants);
	if (n <= 1) return 0;
	const rounds = n % 2 === 0 ? n - 1 : n;
	return doubleLegged ? rounds * 2 : rounds;
}

/** Nombre total de tours pour un format donné. */
export function stageRounds(type: StageType, participants: number, doubleLegged = false): number {
	switch (type) {
		case StageType.single_elimination:
			return singleEliminationRounds(participants);
		case StageType.double_elimination:
			return doubleEliminationRounds(participants);
		case StageType.round_robin:
		case StageType.league:
			return roundRobinRounds(participants, doubleLegged);
		default:
			return 0;
	}
}

/** Nombre total de matchs d'un format donné. */
export function stageMatchCount(type: StageType, participants: number, doubleLegged = false): number {
	const n = toCount(participants);
	if (n <= 1) return 0;
	switch (type) {
		// Chaque match élimine exactement un joueur.
		case StageType.single_elimination:
			return n - 1;
		// Chacun doit perdre deux fois, sauf le vainqueur (+1 si reset de finale).
		case StageType.double_elimination:
			return 2 * n - 2;
		case StageType.round_robin:
		case StageType.league:
			return (doubleLegged ? n : n / 2) * (n - 1);
		default:
			return 0;
	}
}

/** Libellé canonique d'un tour depuis la fin (1 = finale). */
export function roundLabelFromEnd(roundsRemaining: number): string {
	switch (toCount(roundsRemaining)) {
		case 1:
			return "Finale";
		case 2:
			return "Demi-finales";
		case 3:
			return "Quarts de finale";
		case 4:
			return "Huitièmes de finale";
		case 5:
			return "Seizièmes de finale";
		default:
			return `Tour ${roundsRemaining}`;
	}
}

/** Libellé du tour `round` (1-indexé) d'un arbre de `participants` joueurs. */
export function roundLabel(round: number, participants: number): string {
	const total = singleEliminationRounds(participants);
	if (total === 0 || round < 1) return "";
	return roundLabelFromEnd(total - round + 1);
}

/**
 * Nombre de manches d'un match selon son format.
 * `CUSTOM` dépend de `customChildCount`, fourni par le tournoi.
 */
export function matchGameCount(format: MatchFormat, customChildCount?: number | null): number {
	switch (format) {
		case MatchFormat.BO1:
			return 1;
		case MatchFormat.BO3:
			return 3;
		case MatchFormat.BO5:
			return 5;
		case MatchFormat.DOUBLE_LEG:
			return 2;
		case MatchFormat.CUSTOM:
			return toPositiveInt(customChildCount ?? 1);
		default:
			return 1;
	}
}

/** Manches à gagner pour emporter le match (`DOUBLE_LEG` se joue au cumul). */
export function gamesToWin(format: MatchFormat, customChildCount?: number | null): number {
	if (format === MatchFormat.DOUBLE_LEG) return 2;
	return Math.ceil(matchGameCount(format, customChildCount) / 2);
}

/**
 * Le seeding standard : place les têtes de série de façon qu'elles ne se
 * rencontrent que le plus tard possible (1 v 16, 8 v 9, 4 v 13, …).
 * Renvoie les seeds 1-indexés dans l'ordre des positions de l'arbre.
 */
export function standardSeedOrder(bracketSize: number): number[] {
	const size = nextPowerOfTwo(bracketSize);
	let order = [1];
	while (order.length < size) {
		const round = order.length * 2;
		const next: number[] = [];
		for (const seed of order) {
			next.push(seed, round + 1 - seed);
		}
		order = next;
	}
	return order;
}
