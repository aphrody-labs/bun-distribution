import type { GuardFunction } from "discordx";
import { type CommandInteraction, MessageFlags } from "discord.js";
import { isBotOwner } from "~/lib/env";

export const OwnerOnly: GuardFunction<CommandInteraction> = async (interaction, _client, next) => {
	const allowed = isBotOwner(interaction.user.id);
	if (!allowed) {
		if (interaction.isRepliable()) {
			await interaction.reply({
				content: "Commande réservée au propriétaire du bot.",
				flags: MessageFlags.Ephemeral,
			});
		}
		return;
	}
	await next();
};
