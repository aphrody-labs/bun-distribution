import type { ActionRowBuilder, BaseMessageOptions, EmbedBuilder, Message } from "discord.js";

import { adminManagerConfig, coreManagerConfig } from "@/configs";
import type { Clan, Guild } from "@/entities";
import type { Logger } from "@/services";

export async function sendMessage(
	content: string,
	channelId: string,
	logger: Logger,
	components?: ActionRowBuilder<any>[],
	files?: string[]
) {
	return (await logger.discordChannel(
		channelId,
		{ content, components, files },
		"info"
	)) as Message;
}

export async function sendEmbed(
	embed: EmbedBuilder,
	channelId: string,
	logger: Logger,
	components?: ActionRowBuilder<any>[],
	content: string = ""
) {
	return (await logger.discordChannel(
		channelId,
		{ content, embeds: [embed], components },
		"info"
	)) as Message;
}

export async function logOnClanChannels(logger: Logger, message: BaseMessageOptions, clan: Clan) {
	await logOnAchilleaSpecificClanChannel(logger, message, clan.channelId);

	await logOnClanGuildChannel(logger, message, clan.guild);
}

export async function logOnClanGuildChannel(
	logger: Logger,
	message: BaseMessageOptions,
	guild: Guild | null | undefined
) {
	if (guild?.broadcastChannel) {
		return await logger.discordChannel(guild.broadcastChannel, message, "info");
	}
}

export async function logOnAchilleaSpecificClanChannel(
	logger: Logger,
	message: BaseMessageOptions,
	channelId: string
) {
	return await logger.discordChannel(channelId, message, "info");
}

export async function logOnAchilleaGenericClanChannel(logger: Logger, message: BaseMessageOptions) {
	return await logger.makeAnnouncement(coreManagerConfig.clanAnnouncementsChannelId, message);
}

export async function logOnAchilleaDefaultBotChannel(logger: Logger, message: BaseMessageOptions) {
	return await logger.discordChannel(coreManagerConfig.botChannelId, message, "info");
}

export async function logOnAdministrativeChannel(logger: Logger, message: BaseMessageOptions) {
	return await logger.discordChannel(
		adminManagerConfig.clansAdministrativeChannel,
		message,
		"info"
	);
}

export async function logOnSuperAdminChannel(logger: Logger, message: BaseMessageOptions) {
	return await logger.discordChannel(adminManagerConfig.superadminsChannel, message, "info");
}

export async function logOnAchilleaRankedChannel(logger: Logger, message: BaseMessageOptions) {
	return await logger.discordChannel(
		coreManagerConfig.rankedAnnouncementsChannelId,
		message,
		"info"
	);
}
