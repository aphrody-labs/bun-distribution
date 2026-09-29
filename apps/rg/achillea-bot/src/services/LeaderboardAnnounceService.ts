import { Client } from "@aphrody/discordx";
import type { TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { Kysely } from "kysely";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { coreManagerConfig } from "@/configs";
import { Service } from "@/decorators";
import { MatchMode, SeasonState } from "@/utils/enums";

import { DataStore } from "./DataStore";
import { LeaderboardService, type LeaderboardPage } from "./LeaderboardService";

interface LeaderboardAnnounceDatabase {
	season: { id: string; name: string; state: string; starts_at: Date };
	rank: {
		key: string;
		min_elo: number;
		max_elo: number;
		emoji_id: string;
		emoji_key: string;
	};
	user: { id: string; display_name: string; username: string | null };
}

type AnnouncementRank = {
	key: string;
	minElo: number;
	maxElo: number;
	emojiId: string;
	emojiKey: string;
};

const sql = createAchilleaSql<LeaderboardAnnounceDatabase>() as Kysely<LeaderboardAnnounceDatabase>;

/**
 * Publie et maintient à jour le classement Ranked dans le salon 🏅・leaderboard.
 * Lecture seule sur le ranked web (user_elo) : aucun couplage avec le matchmaking
 * Discord (dormant). Un message unique est édité en place (pas de spam).
 */
@Service()
export class LeaderboardAnnounceService {
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private dataStore: DataStore,
		private leaderboard: LeaderboardService,
		private client: Client
	) {}

	/**
	 * Démarre le rafraîchissement périodique (affichage immédiat puis toutes les 10 min).
	 * Idempotent : un second appel ne crée pas de timer en double.
	 * NB : on n'utilise pas @Schedule car le Scheduler global n'est pas démarré
	 * (startAllJobs() vit dans un readyHandler inerte — voir events/ranked-integrations.ts).
	 */
	start(): void {
		if (this.timer) return;
		void this.refreshLeaderboard();
		this.timer = setInterval(() => void this.refreshLeaderboard(), 10 * 60_000);
	}

	async refreshLeaderboard(): Promise<void> {
		const channelId = coreManagerConfig.leaderboardChannelId;
		console.info(`[leaderboard] refresh (salon=${channelId || "non configuré"})`);
		if (!channelId) return; // pas configuré (ex. serveur de test) → on n'affiche rien

		try {
			const season = await sql
				.selectFrom("season")
				.select(["id", "name"])
				.where("state", "=", SeasonState.Active)
				.orderBy("starts_at", "desc")
				.executeTakeFirst();
			const embed = await this.buildEmbed(season?.id ?? null, season?.name ?? "Saison en cours");
			await this.postOrEdit(channelId, embed);
		} catch (e) {
			console.error("[leaderboard] refresh KO", e);
		}
	}

	private tierLabelFactory(ranks: AnnouncementRank[]): (elo: number) => string {
		const sorted = [...ranks].sort((a, b) => a.minElo - b.minElo);
		return (elo: number) => {
			const r = sorted.find((x) => elo >= x.minElo && elo <= x.maxElo) ?? sorted[0];
			if (!r) return "";
			return r.emojiId ? `<:${r.emojiKey || r.key}:${r.emojiId}> ` : "";
		};
	}

	private async buildEmbed(
		seasonId: string | null,
		seasonName: string
	): Promise<EmbedBuilder> {
		const [solo, duo] = await Promise.all([
			this.leaderboard.getTop(seasonId, MatchMode.ONE_VS_ONE, 10),
			this.leaderboard.getTop(seasonId, MatchMode.TWO_VS_TWO, 10),
		]);

		const ids = [...new Set([...solo.entries, ...duo.entries].map((e) => e.userId))];
		const users = ids.length
			? await sql
					.selectFrom("user")
					.select(["id", "display_name", "username"])
					.where("id", "in", ids)
					.execute()
			: [];
		const nameOf = new Map(users.map((u) => [u.id, u.display_name || u.username || "Joueur"]));
		const ranks = await sql
			.selectFrom("rank")
			.select([
				"key",
				"min_elo as minElo",
				"max_elo as maxElo",
				"emoji_id as emojiId",
				"emoji_key as emojiKey",
			])
			.execute();
		const tierOf = this.tierLabelFactory(ranks);

		const fmt = (page: LeaderboardPage): string => {
			// On n'affiche que les joueurs ayant réellement disputé au moins une partie.
			const ranked = page.entries.filter((e) => e.gamesPlayed > 0);
			if (!ranked.length) return "_Aucun joueur classé._";
			return ranked
				.map((e) => {
					const medal =
						e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `\`#${e.rank}\``;
					const name = nameOf.get(e.userId) ?? "Joueur";
					const games = `${e.gamesPlayed} partie${e.gamesPlayed > 1 ? "s" : ""}`;
					return `${medal} ${tierOf(e.elo)}**${name}** — ${e.elo} pts · ${games}`;
				})
				.join("\n");
		};

		return new EmbedBuilder()
			.setTitle("🏅 Classement Ranked")
			.setDescription(`Saison **${seasonName}** · mis à jour automatiquement toutes les 10 min`)
			.addFields(
				{ name: "🎮 1v1", value: fmt(solo), inline: false },
				{ name: "👥 2v2", value: fmt(duo), inline: false }
			)
			.setColor(0xf1c40f)
			.setFooter({ text: "achillea.rosegriffon.fr" })
			.setTimestamp(new Date());
	}

	private async postOrEdit(channelId: string, embed: EmbedBuilder): Promise<void> {
		const channel = (await this.client.channels.fetch(channelId).catch((e) => {
			console.error(`[leaderboard] fetch salon ${channelId} KO`, e);
			return null;
		})) as TextChannel | null;
		if (!channel || typeof channel.send !== "function") {
			console.warn(`[leaderboard] salon ${channelId} introuvable ou non textuel`);
			return;
		}

		let existing = "";
		try {
			existing = await this.dataStore.get("leaderboardMessageId");
		} catch {
			existing = "";
		}

		if (existing) {
			const msg = await channel.messages.fetch(existing).catch(() => null);
			if (msg && msg.author.id === this.client.user?.id) {
				await msg.edit({ embeds: [embed] });
				console.info("[leaderboard] message édité");
				return;
			}
			if (msg) {
				console.warn(
					`[leaderboard] message ${existing} appartient au bot ${msg.author.id}; remplacement pour le profil actif`
				);
			}
		}

		const sent = await channel.send({ embeds: [embed] });
		await this.dataStore.set("leaderboardMessageId", sent.id);
		console.info(`[leaderboard] message publié (${sent.id})`);
	}
}
