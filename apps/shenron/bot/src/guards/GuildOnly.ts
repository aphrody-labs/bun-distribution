import type { GuardFunction } from "discordx";
import type { CommandInteraction, ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";

export const GuildOnly: GuardFunction<
	CommandInteraction | ButtonInteraction | ModalSubmitInteraction
> = async (interaction, _client, next) => {
	if (!interaction.guild) {
		if (interaction.isRepliable()) {
			await interaction.reply({
				content: "Commande disponible uniquement sur le serveur.",
				flags: MessageFlags.Ephemeral,
			});
		}
		return;
	}
	await next();
};
