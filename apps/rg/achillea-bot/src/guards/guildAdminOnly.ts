import { MessageFlags, PermissionFlagsBits } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { followUpWithErrorEmbed } from "@/utils/functions";

export const GuildAdminOnly: GuardFunction = async (interaction, client, next) => {
	if (!interaction.guild) {
		await interaction.reply({
			content: "❌ Cette commande ne peut être utilisée que dans un serveur.",
			ephemeral: true,
		});

		return;
	}

	const member = await interaction.guild.members.fetch(interaction.user.id);

	// Check for Administrator permission
	if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		await followUpWithErrorEmbed(
			interaction,
			" Vous devez être administrateur du serveur pour utiliser cette commande."
		);

		return;
	}

	// ✅ Continue execution
	await next();
};
