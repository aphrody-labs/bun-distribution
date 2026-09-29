/**
 * Versement des gains de base des mini-jeux, avec garde-fous anti-farm :
 *   - plafond de victoires récompensées par joueur sur 24 h glissantes, compté
 *     dans le grand livre `action_logs` (survit aux redémarrages) ;
 *   - plafond par paire de joueurs en duel (anti-collusion, en mémoire).
 * Au-delà, la partie reste jouable mais ne rapporte rien.
 */
import { singleton, inject } from "tsyringe";
import { and, eq, gte, like, sql } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { actionLogs } from "~/db/schema";
import { EconomyService } from "~/services/EconomyService";
import { SettingsService } from "~/services/SettingsService";
import { LogService } from "~/services/LogService";
import { container } from "tsyringe";
import { Client, EmbedBuilder } from "discord.js";
import { formatZeni } from "~/lib/zeni";
import {
	DAY_MS,
	GAME_DAILY_REWARD_CAP_DEFAULT,
	GAME_PAIR_REWARD_CAP_DEFAULT,
	SlidingWindowCounter,
	pairKey,
	rewardBlockReason,
	settleStakes,
	type RewardBlock,
	type StakeSettlement,
} from "~/services/games/anti-farm";

export interface GrantResult {
	paid: number;
	blocked: RewardBlock | null;
}

@singleton()
export class GameRewardService {
	private readonly pairs = new SlidingWindowCounter(DAY_MS);
	/** Versements en cours (entre la lecture du compteur et l'écriture du grand livre). */
	private readonly inflight = new Map<string, number>();

	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(SettingsService) private settings: SettingsService,
		@inject(EconomyService) private eco: EconomyService
	) {}

	async rewardedWinsLastDay(userId: string, now = Date.now()): Promise<number> {
		const rows = await this.dbs.db
			.select({ n: sql<number>`count(*)` })
			.from(actionLogs)
			.where(
				and(
					eq(actionLogs.userId, userId),
					eq(actionLogs.action, "ZENI_GAIN"),
					like(actionLogs.meta, '%"kind":"game"%'),
					gte(actionLogs.createdAt, new Date(now - DAY_MS))
				)
			);
		return Number(rows[0]?.n ?? 0);
	}

	/**
	 * Journal du salon casino : chaque gain versé ou refusé par un plafond.
	 * Best-effort — un salon absent ne bloque jamais un versement.
	 */
	private async logGame(input: {
		userId: string;
		game?: string;
		amount: number;
		opponentId?: string;
		result: GrantResult;
	}) {
		try {
			const balance = await this.eco.getBalance(input.userId);
			const embed = new EmbedBuilder()
				.setColor(input.result.blocked ? 0x94a3b8 : 0xf5b52e)
				.setTitle(
					input.result.blocked
						? `Gain bloqué · ${input.game ?? "mini-jeu"}`
						: `Gain versé · ${input.game ?? "mini-jeu"}`
				)
				.addFields(
					{ name: "Joueur", value: `<@${input.userId}>`, inline: true },
					{
						name: input.result.blocked ? "Gain refusé" : "Gain",
						value: formatZeni(input.result.blocked ? input.amount : input.result.paid),
						inline: true,
					},
					{ name: "Solde", value: formatZeni(balance), inline: true }
				)
				.setTimestamp(new Date());
			if (input.opponentId) embed.addFields({ name: "Adversaire", value: `<@${input.opponentId}>`, inline: true });
			if (input.result.blocked) {
				embed.addFields({
					name: "Plafond",
					value:
						input.result.blocked === "daily-cap"
							? "Victoires payées sur 24 h atteintes"
							: "Victoires payées contre ce même adversaire atteintes",
				});
			}
			await container.resolve(LogService).send(container.resolve(Client), "games", embed);
		} catch {
			/* pas de client ou de salon casino configuré */
		}
	}

	/** Verse `amount` (gain de base) si aucun plafond n'est atteint. */
	async grantWin(input: {
		userId: string;
		amount: number;
		opponentId?: string;
		/** Nom du jeu, pour le journal du salon casino. */
		game?: string;
	}): Promise<GrantResult> {
		const result = await this.grantWinInner(input);
		void this.logGame({ ...input, result });
		return result;
	}

	private async grantWinInner(input: { userId: string; amount: number; opponentId?: string }): Promise<GrantResult> {
		if (input.amount <= 0) return { paid: 0, blocked: null };
		const now = Date.now();
		const pending = this.inflight.get(input.userId) ?? 0;
		this.inflight.set(input.userId, pending + 1);
		try {
			const [dailyCap, pairCap, ledgerCount] = await Promise.all([
				this.settings.getInt("games.daily_reward_cap", GAME_DAILY_REWARD_CAP_DEFAULT),
				this.settings.getInt("games.pair_reward_cap", GAME_PAIR_REWARD_CAP_DEFAULT),
				this.rewardedWinsLastDay(input.userId, now),
			]);
			const key = input.opponentId ? pairKey(input.userId, input.opponentId) : undefined;
			const blocked = rewardBlockReason({
				dailyCount: ledgerCount + pending,
				dailyCap,
				pairCount: key ? this.pairs.count(key, now) : undefined,
				pairCap,
			});
			if (blocked) return { paid: 0, blocked };
			if (key) this.pairs.record(key, now);
			await this.eco.addZeni(input.userId, input.amount, { kind: "game" });
			return { paid: input.amount, blocked: null };
		} finally {
			const left = (this.inflight.get(input.userId) ?? 1) - 1;
			if (left <= 0) this.inflight.delete(input.userId);
			else this.inflight.set(input.userId, left);
		}
	}

	/**
	 * Séquestre la mise des deux joueurs au lancement d'un duel. Si le second
	 * débit échoue, le premier est rendu. `false` = duel impossible.
	 */
	async escrowStakes(a: string, b: string, stake: number): Promise<boolean> {
		if (stake <= 0) return true;
		if (!(await this.eco.removeZeni(a, stake))) return false;
		if (!(await this.eco.removeZeni(b, stake))) {
			await this.eco.addZeni(a, stake, { kind: "stake" });
			return false;
		}
		return true;
	}

	/** Restitue un pot séquestré (somme nulle, sans multiplicateur ni fusion). */
	async payStakes(kind: StakeSettlement, winnerId: string, loserId: string, stake: number): Promise<void> {
		const split = settleStakes(kind, stake);
		if (split.winner > 0) await this.eco.addZeni(winnerId, split.winner, { kind: "stake" });
		if (split.loser > 0) await this.eco.addZeni(loserId, split.loser, { kind: "stake" });
	}
}
