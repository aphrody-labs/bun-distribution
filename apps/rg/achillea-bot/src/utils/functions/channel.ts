import type { Guild, TextChannel } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import { coreManagerConfig } from "@/configs";

export async function createClanSpecificChannel(
	guild: Guild,
	category: string,
	channelName: string,
	roleId: string,
	captainId: string
) {
	const channel = {
		name: channelName,
		type: 0, // text channel
		parent: category,
		topic: `Dedicated to the Clan ${channelName}`,
		permissionOverwrites: [
			{
				id: guild.roles.everyone.id,
				deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
				allow: [PermissionFlagsBits.UseApplicationCommands, PermissionFlagsBits.AttachFiles],
			},
			{
				id: roleId,
				allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
			},
			{
				id: coreManagerConfig.botId,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.ManageMessages,
				],
			},
			{
				id: captainId,
				allow: [PermissionFlagsBits.SendMessages],
			},
		],
	};

	try {
		const createdChannel = await guild.channels.create(channel);

		return createdChannel as TextChannel;
	} catch (err: any) {
		console.error("Failed to create channel:", err);
		throw err;
	}
}
