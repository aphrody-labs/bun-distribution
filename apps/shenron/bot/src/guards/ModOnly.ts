import type { GuardFunction } from "discordx";
import { type CommandInteraction, MessageFlags, PermissionFlagsBits } from "discord.js";
import { isBotOwner } from "~/lib/env";

export const ModOnly: GuardFunction<CommandInteraction> = async (interaction, _client, next) => {
	if (!interaction.inCachedGuild()) return;
	const isOwner = isBotOwner(interaction.user.id);
	const hasPerm = interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers);
	if (!isOwner && !hasPerm) {
		await interaction.reply({
			content: "Permission insuffisante (ModerateMembers requis).",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	await next();
};
