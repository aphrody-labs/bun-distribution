/**
 * Garde-fous anti-farm des mini-jeux — logique pure, sans base ni Discord.
 *
 * Constats en production (2026-09-11/12) : victoires en série contre le robot
 * du morpion avec la mise maximale, parties parallèles, gains de mise multipliés
 * par la race, états signés de l'API web rejouables pendant 30 min.
 */

export const DAY_MS = 86_400_000;
export const GAME_DAILY_REWARD_CAP_DEFAULT = 20;
export const GAME_PAIR_REWARD_CAP_DEFAULT = 3;

/** Clé symétrique d'une paire de joueurs. */
export function pairKey(a: string, b: string): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Compteur d'événements sur fenêtre glissante, par clé. */
export class SlidingWindowCounter {
	private readonly events = new Map<string, number[]>();

	constructor(private readonly windowMs: number) {}

	count(key: string, now = Date.now()): number {
		const list = this.events.get(key);
		if (!list) return 0;
		const fresh = list.filter((t) => now - t < this.windowMs);
		if (fresh.length === 0) this.events.delete(key);
		else this.events.set(key, fresh);
		return fresh.length;
	}

	record(key: string, now = Date.now()): void {
		const list = this.events.get(key) ?? [];
		list.push(now);
		this.events.set(key, list);
	}
}

/**
 * Jetons à usage unique (états signés de l'API web). `consume` renvoie `false`
 * si le jeton a déjà servi pendant sa durée de validité.
 */
export class SingleUseTokens {
	private readonly used = new Map<string, number>();

	consume(token: string, ttlMs: number, now = Date.now()): boolean {
		for (const [t, exp] of this.used) if (exp <= now) this.used.delete(t);
		if (this.used.has(token)) return false;
		this.used.set(token, now + ttlMs);
		return true;
	}

	get size(): number {
		return this.used.size;
	}
}

export type RewardBlock = "daily-cap" | "pair-cap";

/** Décide si une victoire donne droit au gain de base. */
export function rewardBlockReason(input: {
	dailyCount: number;
	dailyCap: number;
	pairCount?: number;
	pairCap?: number;
}): RewardBlock | null {
	if (input.dailyCount >= Math.max(0, input.dailyCap)) return "daily-cap";
	if (input.pairCount !== undefined && input.pairCount >= Math.max(0, input.pairCap ?? 0)) {
		return "pair-cap";
	}
	return null;
}

export type StakeSettlement = "win" | "draw" | "forfeit" | "cancel";

/**
 * Répartition de mises séquestrées (chaque joueur a déposé `stake`).
 * Somme nulle : le pot est rendu tel quel, rien n'est créé.
 */
export function settleStakes(
	kind: StakeSettlement,
	stake: number
): { winner: number; loser: number } {
	const s = Math.max(0, Math.trunc(stake));
	if (kind === "win" || kind === "forfeit") return { winner: 2 * s, loser: 0 };
	return { winner: s, loser: s };
}

/** Les mises ne sont acceptées qu'en duel : contre le robot, un bon joueur ne perd jamais sa mise. */
export function stakeAllowed(mode: "bot" | "joueur", stake: number | undefined): boolean {
	return stake === undefined || stake <= 0 || mode === "joueur";
}

export const REWARD_BLOCK_LABELS: Record<RewardBlock, string> = {
	"daily-cap": "plafond quotidien de victoires récompensées atteint",
	"pair-cap": "trop de victoires récompensées contre ce même adversaire aujourd'hui",
};
