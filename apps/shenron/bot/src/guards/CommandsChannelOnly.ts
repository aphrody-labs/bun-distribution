import type { GuardFunction } from "discordx";
import type { CommandInteraction, ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { container } from "tsyringe";
import { env, isBotOwner } from "~/lib/env";
import { SettingsService } from "~/services/SettingsService";

/**
 * Guard : restreint les interactions au salon configuré dans
 * `channel.commands` (priorité runtime) ou `env.COMMANDS_CHANNEL_ID` (fallback).
 *
 * **Bypass staff** : owner, bot-dev et tout membre avec `ModerateMembers`
 * peuvent utiliser les commandes depuis n'importe quel salon — utile pour
 * l'équipe modé qui doit pouvoir exécuter des commandes dans le salon où la
 * situation se produit (ex: signaler un comportement depuis le salon source).
 */
export const CommandsChannelOnly: GuardFunction<
	CommandInteraction | ButtonInteraction | ModalSubmitInteraction
> = async (interaction, _client, next) => {
	const settings = container.resolve(SettingsService);
	const override = await settings.getSnowflake("channel.commands");
	const target = override ?? env.COMMANDS_CHANNEL_ID;
	if (target && interaction.channelId !== target) {
		const userId = interaction.user.id;
		const isOwner = isBotOwner(userId);
		const isStaff =
			interaction.inCachedGuild() &&
			interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers);
		if (!isOwner && !isStaff) {
			if (interaction.isRepliable()) {
				await interaction.reply({
					content: `Utilise <#${target}> pour les commandes.`,
					flags: MessageFlags.Ephemeral,
				});
			}
			return;
		}
	}
	await next();
};
