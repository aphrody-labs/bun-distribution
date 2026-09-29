import type { ButtonBuilder, ButtonInteraction } from "discord.js";
import { ActionRowBuilder, MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { ButtonComponent, Discord, Injectable } from "@/decorators";
import { User } from "@/entities";
import { Database } from "@/services";
import { createMemberHistoryEmbed } from "@/utils/functions";

import { buildInviteToClanButton } from "../../utils/functions/components";

@Discord()
@Injectable()
export class MiscellaneaousButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /^get_clan_history:.+/ })
	async getClanHistory(interaction: ButtonInteraction, client: Client) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const [, userId] = interaction.customId.split(":");

		const botUser = await this.db.get(User).findOne({ id: userId });
		const discordUser = await client.users.fetch(userId);

		await interaction.followUp({
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(buildInviteToClanButton(userId)) as any,
			],
			embeds: [await createMemberHistoryEmbed(discordUser, botUser!, this.db)],
		});
	}

	@ButtonComponent({ id: "dismiss-message" })
	async dismissMessage(interaction: ButtonInteraction) {
		await interaction.deferUpdate();
		await interaction.deleteReply();
	}
}
