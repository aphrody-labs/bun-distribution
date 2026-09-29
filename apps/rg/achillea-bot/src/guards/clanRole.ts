import type { ButtonInteraction, CommandInteraction } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { replyWithSimpleErrorEmbed } from "@/utils/functions";

import type { ClanMemberRole } from "../utils/enums";

export function ClanRole(role: ClanMemberRole) {
	const guard: GuardFunction<CommandInteraction | ButtonInteraction> = async (
		interaction,
		client,
		next,
		guardData
	) => {
		if (guardData.clanMember.role < role) {
			await replyWithSimpleErrorEmbed(
				interaction,
				"You do not have permission to run this command."
			);

			return;
		}

		await next(guardData);
	};

	return guard;
}
