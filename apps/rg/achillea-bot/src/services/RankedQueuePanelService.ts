import { Client } from "@aphrody/discordx";
import type { TextChannel } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { Kysely } from "kysely";
import { sql as sqlTag } from "kysely";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { coreManagerConfig, urlsConfig } from "@/configs";
import { Service } from "@/decorators";

import { DataStore } from "./DataStore";

interface ResultRow {
	p1: string | null;
	s1: number | null;
	p2: string | null;
	s2: number | null;
}

interface RankedQueueDatabase {
	user_elo: { user_id: string; games_played: number };
	lobby: { id: number; event_type: string; state: string; mode: number };
	lobby_user: { lobby_id: number; user_id: string; team: number; score: number | null };
	user: { id: string; display_name: string; username: string | null };
}

const sql = createAchilleaSql<RankedQueueDatabase>() as Kysely<RankedQueueDatabase>;

/**
 * Salon 🎮・ranked-queue : panneau persistant servant de pont vers le ranked web.
 * Bouton « Jouer sur le site » + nombre de joueurs classés + derniers résultats 1v1.
 * Le matchmaking lui-même reste sur le site (Colyseus) ; ce salon n'ouvre aucune file Discord.
 */
@Service()
export class RankedQueuePanelService {
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private dataStore: DataStore, private client: Client) {}

	start(): void {
		if (this.timer) return;
		void this.refresh();
		this.timer = setInterval(() => void this.refresh(), 10 * 60_000);
	}

	async refresh(): Promise<void> {
		const channelId = coreManagerConfig.rankedQueueChannelId;
		if (!channelId) return;

		try {
			const countRow = await sql
				.selectFrom("user_elo")
				.select(({ fn }) => fn.countAll<number>().as("c"))
				.where("games_played", ">", 0)
				.executeTakeFirst();
			const activePlayers = Number(countRow?.c ?? 0);

			const results = (
				await sqlTag<ResultRow>`
				SELECT
					max(COALESCE(NULLIF(u.display_name, ''), u.username)) FILTER (WHERE lu.team = 1) AS p1,
					max(lu.score) FILTER (WHERE lu.team = 1) AS s1,
					max(COALESCE(NULLIF(u.display_name, ''), u.username)) FILTER (WHERE lu.team = 2) AS p2,
					max(lu.score) FILTER (WHERE lu.team = 2) AS s2
				FROM lobby l
				JOIN lobby_user lu ON lu.lobby_id = l.id
				JOIN "user" u ON u.id = lu.user_id
				WHERE l.event_type = 'RANKED' AND l.state = 'Finished' AND l.mode = 2
				GROUP BY l.id
				ORDER BY l.id DESC
				LIMIT 5`
				.execute(sql)
			).rows;

			const feed =
				results.length > 0
					? results
							.map((r) => {
								const p1 = r.p1 ?? "Joueur";
								const p2 = r.p2 ?? "Joueur";
								const s1 = r.s1 ?? 0;
								const s2 = r.s2 ?? 0;
								const bold1 = s1 >= s2 ? `**${p1}**` : p1;
								const bold2 = s2 > s1 ? `**${p2}**` : p2;
								return `${bold1} ${s1}–${s2} ${bold2}`;
							})
							.join("\n")
					: "_Aucun match récent._";

			const embed = new EmbedBuilder()
				.setTitle("🎮 File Ranked")
				.setDescription(
					"Rejoins la file et joue tes matchs classés **directement sur le site** — " +
						"le résultat, ton Elo et ton palier sont mis à jour en temps réel."
				)
				.addFields(
					{ name: "Joueurs classés", value: `**${activePlayers}**`, inline: true },
					{ name: "Derniers résultats (1v1)", value: feed, inline: false }
				)
				.setColor(0x5865f2)
				.setFooter({ text: "Le matchmaking se fait sur le site." });

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel("🔗 Jouer sur le site")
					.setURL(`${urlsConfig.website}/ranked`)
			);

			await this.postOrEdit(channelId, embed, row);
		} catch (e) {
			console.error("[ranked-queue] refresh KO", e);
		}
	}

	private async postOrEdit(
		channelId: string,
		embed: EmbedBuilder,
		row: ActionRowBuilder<ButtonBuilder>
	): Promise<void> {
		const channel = (await this.client.channels
			.fetch(channelId)
			.catch(() => null)) as TextChannel | null;
		if (!channel || typeof channel.send !== "function") {
			console.warn(`[ranked-queue] salon ${channelId} introuvable`);
			return;
		}

		let existing = "";
		try {
			existing = await this.dataStore.get("rankedQueueMessageId");
		} catch {
			existing = "";
		}

		const payload = { embeds: [embed], components: [row] };
		if (existing) {
			const msg = await channel.messages.fetch(existing).catch(() => null);
			if (msg && msg.author.id === this.client.user?.id) {
				await msg.edit(payload);
				return;
			}
			if (msg) {
				console.warn(
					`[ranked-queue] message ${existing} appartient au bot ${msg.author.id}; remplacement pour le profil actif`
				);
			}
		}
		const sent = await channel.send(payload);
		await this.dataStore.set("rankedQueueMessageId", sent.id);
		console.info(`[ranked-queue] panneau publié (${sent.id})`);
	}
}
