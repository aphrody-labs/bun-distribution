import type { GuardFunction } from "discordx";
import { type CommandInteraction, MessageFlags, PermissionFlagsBits } from "discord.js";
import { isBotOwner } from "~/lib/env";

export const AdminOnly: GuardFunction<CommandInteraction> = async (interaction, _client, next) => {
	if (!interaction.inCachedGuild()) return;
	const isOwner = isBotOwner(interaction.user.id);
	const hasPerm = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
	if (!isOwner && !hasPerm) {
		await interaction.reply({
			content: "Permission insuffisante (Administrator requis).",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	await next();
};
