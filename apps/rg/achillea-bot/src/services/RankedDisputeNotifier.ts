import { Client } from "@aphrody/discordx";
import type { TextChannel } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";

import { coreManagerConfig } from "@/configs";
import { Service } from "@/decorators";

/**
 * Relaie les preuves de litige Ranked vers le salon des Tournament Organizers
 * (`coreManagerConfig.toChannelId`). Appelé par l'endpoint interne
 * `POST /notifications/ranked-proof`, lui-même déclenché par le sous-process ranked
 * après l'upload d'une capture (route `/api/ranked/:lobbyId/dispute`).
 */
@Service()
export class RankedDisputeNotifier {
	constructor(private client: Client) {}

	async notifyProofToTO(lobbyId: number, userId: string, url: string): Promise<void> {
		const toId = coreManagerConfig.toChannelId;
		if (!toId) return;

		const channel = (await this.client.channels
			.fetch(toId)
			.catch(() => null)) as TextChannel | null;
		if (!channel || typeof channel.send !== "function") return;

		const isAbsolute = /^https?:\/\//i.test(url);
		const embed = new EmbedBuilder()
			.setTitle("🧾 Nouvelle preuve de litige Ranked")
			.setDescription(`Lobby **#${lobbyId}** — preuve déposée par <@${userId}>`)
			.setColor(0xe67e22)
			.setFooter({ text: "À arbitrer via le dashboard admin." })
			.setTimestamp(new Date());

		const components: ActionRowBuilder<ButtonBuilder>[] = [];
		if (isAbsolute) {
			embed.setImage(url);
			components.push(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("🔗 Ouvrir la preuve").setURL(url)
				)
			);
		} else {
			embed.addFields({ name: "Preuve", value: url });
		}

		await channel
			.send({ embeds: [embed], components, allowedMentions: { users: [userId] } })
			.catch((e) => console.error("[ranked-proof] envoi salon TO KO", e));
	}
}
