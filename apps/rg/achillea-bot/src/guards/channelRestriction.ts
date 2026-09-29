import { CommandInteraction } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import { ClanMember } from "@/entities";
import { Database } from "@/services";
import {
	isDev,
	replyWithSimpleErrorEmbed,
	resolveChannel,
	resolveDependency,
	resolveGuild,
	resolveUser,
} from "@/utils/functions";

export const ChannelRestriction: GuardFunction = async (arg, client, next, guardData) => {
	if (arg instanceof CommandInteraction) {
		const user = resolveUser(arg);

		if (user && isDev(user.id)) return await next();

		const guild = resolveGuild(arg);
		const channel = resolveChannel(arg);

		if (user && guild && channel && guild.id === coreManagerConfig.coreGuildId) {
			const db = await resolveDependency(Database);
			const clanMember = await db
				.get(ClanMember)
				.findOne({ user: user.id }, { populate: ["clan", "clan.guild"] });

			if (channel.id === coreManagerConfig.botChannelId) {
				return await next();
			}
			if (clanMember && channel.id === clanMember.clan.channelId) {
				return await next();
			}
			await replyWithSimpleErrorEmbed(arg, "You cannot use commands in this channel");
		} else {
			return await next();
		}
	} else {
		return await next();
	}
};
