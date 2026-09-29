/**
 * Morpion (tic-tac-toe 3×3) — logique pure, sans dépendance Discord.
 * Source de vérité partagée par /morpion (Discord) et `POST /api/games/morpion/*`.
 */

export type MorpionCell = "." | "X" | "O";
export type MorpionMark = "X" | "O";

const MORPION_WIN_LINES: ReadonlyArray<readonly [number, number, number]> = [
	[0, 1, 2],
	[3, 4, 5],
	[6, 7, 8],
	[0, 3, 6],
	[1, 4, 7],
	[2, 5, 8],
	[0, 4, 8],
	[2, 4, 6],
];

export type MorpionOutcome =
	| { kind: "playing" }
	| { kind: "won"; mark: MorpionMark; line: readonly number[] }
	| { kind: "draw" };

export function emptyBoard(): MorpionCell[] {
	return Array(9).fill(".") as MorpionCell[];
}

export function evaluateBoard(board: MorpionCell[]): MorpionOutcome {
	for (const line of MORPION_WIN_LINES) {
		const [a, b, c] = line;
		const v = board[a];
		if (v !== "." && v === board[b] && v === board[c]) {
			return { kind: "won", mark: v as MorpionMark, line };
		}
	}
	return board.includes(".") ? { kind: "playing" } : { kind: "draw" };
}

/** Identifiant de l'adversaire robot dans une partie. */
export const MORPION_BOT = "BOT";

/**
 * Probabilité qu'a le robot, à chaque coup, de jouer au hasard au lieu du coup
 * parfait. Sans elle le morpion contre le robot serait toujours nul ; avec
 * l'ancienne heuristique « gagner > bloquer > centre > coin », la séquence
 * coin / coin opposé / coin gagnait À COUP SÛR (farm observé en production).
 */
export const MORPION_BOT_BLUNDER_CHANCE = 0.1;

/** Ordre de préférence à score égal : centre, coins, bords. */
const MOVE_PREFERENCE = [4, 0, 2, 6, 8, 1, 3, 5, 7] as const;

const minimaxCache = new Map<string, number>();

/** Score du point de vue de `me` : >0 gagné, <0 perdu, 0 nul. Plus rapide = mieux. */
function minimax(board: MorpionCell[], toMove: MorpionMark, me: MorpionMark, depth: number): number {
	const key = `${board.join("")}${toMove}${me}${depth}`;
	const cached = minimaxCache.get(key);
	if (cached !== undefined) return cached;
	const outcome = evaluateBoard(board);
	let score: number;
	if (outcome.kind === "won") score = outcome.mark === me ? 10 - depth : depth - 10;
	else if (outcome.kind === "draw") score = 0;
	else {
		const next: MorpionMark = toMove === "X" ? "O" : "X";
		score = toMove === me ? -Infinity : Infinity;
		for (let i = 0; i < 9; i++) {
			if (board[i] !== ".") continue;
			board[i] = toMove;
			const s = minimax(board, next, me, depth + 1);
			board[i] = ".";
			score = toMove === me ? Math.max(score, s) : Math.min(score, s);
		}
	}
	minimaxCache.set(key, score);
	return score;
}

export interface MorpionAiOptions {
	/** Probabilité d'un coup aléatoire (0 = jeu parfait, défaut). */
	blunderChance?: number;
	rng?: () => number;
}

/**
 * IA minimax : jeu parfait (ne perd jamais), gain immédiat préféré au blocage,
 * centre puis coins à score égal. `blunderChance` réintroduit des erreurs
 * aléatoires pour que le robot reste battable sans être farmable.
 */
export function decideMorpionMove(
	board: MorpionCell[],
	botMark: MorpionMark = "O",
	opts: MorpionAiOptions = {}
): number {
	const free = board.map((c, i) => (c === "." ? i : -1)).filter((i) => i >= 0);
	if (free.length === 0) return 0;
	const rng = opts.rng ?? Math.random;
	const blunder = Math.max(0, Math.min(1, opts.blunderChance ?? 0));
	if (blunder > 0 && rng() < blunder) {
		return free[Math.min(free.length - 1, Math.floor(rng() * free.length))]!;
	}
	const work = board.slice();
	const opponent: MorpionMark = botMark === "O" ? "X" : "O";
	let best = free[0]!;
	let bestScore = -Infinity;
	for (const i of MOVE_PREFERENCE) {
		if (work[i] !== ".") continue;
		work[i] = botMark;
		const s = minimax(work, opponent, botMark, 1);
		work[i] = ".";
		if (s > bestScore) {
			bestScore = s;
			best = i;
		}
	}
	return best;
}

/** Applique un coup, valide les bornes et l'occupation. Retourne new board ou erreur. */
export function applyMorpionMove(
	board: MorpionCell[],
	cell: number,
	mark: MorpionMark
): { ok: true; board: MorpionCell[] } | { ok: false; error: string } {
	if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
		return { ok: false, error: "Cellule invalide" };
	}
	if (board[cell] !== ".") {
		return { ok: false, error: "Cellule occupée" };
	}
	const next = board.slice();
	next[cell] = mark;
	return { ok: true, board: next };
}

// ─── Session de jeu (partagée Discord) ──────────────────────────────────────

export interface MorpionGame {
	board: MorpionCell[];
	turn: MorpionMark;
	playerX: string;
	/** Identifiant Discord ou `MORPION_BOT`. */
	playerO: string;
	/** Mise séquestrée par joueur (0 = partie sans mise). */
	stake: number;
	status: "playing" | "finished";
}

export function createMorpionGame(playerX: string, playerO: string, stake = 0): MorpionGame {
	return { board: emptyBoard(), turn: "X", playerX, playerO, stake, status: "playing" };
}

export type MorpionTurnResult =
	| { ok: false; reason: "finished" | "not-your-turn" | "invalid" | "occupied" }
	| { ok: true; botCell: number | null; outcome: MorpionOutcome };

/**
 * Joue un coup de façon ATOMIQUE (aucun `await`) : vérifie le tour, applique le
 * coup du joueur puis celui du robot, et passe la partie à `finished` dès
 * qu'elle se termine. Un second clic — double-clic, clic concurrent, bouton
 * resté actif — reçoit `finished` et ne peut plus déclencher de paiement.
 * Le tour du robot n'est jamais jouable par un humain.
 */
export function playMorpionTurn(
	game: MorpionGame,
	userId: string,
	cell: number,
	ai: MorpionAiOptions = {}
): MorpionTurnResult {
	if (game.status !== "playing") return { ok: false, reason: "finished" };
	const current = game.turn === "X" ? game.playerX : game.playerO;
	if (current === MORPION_BOT || userId !== current) return { ok: false, reason: "not-your-turn" };
	if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, reason: "invalid" };
	if (game.board[cell] !== ".") return { ok: false, reason: "occupied" };

	game.board[cell] = game.turn;
	game.turn = game.turn === "X" ? "O" : "X";
	let outcome = evaluateBoard(game.board);
	let botCell: number | null = null;
	if (outcome.kind === "playing" && game.playerO === MORPION_BOT && game.turn === "O") {
		botCell = decideMorpionMove(game.board, "O", ai);
		game.board[botCell] = "O";
		game.turn = "X";
		outcome = evaluateBoard(game.board);
	}
	if (outcome.kind !== "playing") game.status = "finished";
	return { ok: true, botCell, outcome };
}

/** Joueur humain dont c'est le tour (celui qui abandonne si la partie expire). */
export function morpionIdlePlayer(game: MorpionGame): string | null {
	const current = game.turn === "X" ? game.playerX : game.playerO;
	return current === MORPION_BOT ? null : current;
}

/** Vrai si `userId` a déjà une partie en cours parmi `games`. */
export function hasActiveMorpionGame(games: Iterable<MorpionGame>, userId: string): boolean {
	for (const g of games) {
		if (g.status === "playing" && (g.playerX === userId || g.playerO === userId)) return true;
	}
	return false;
}
