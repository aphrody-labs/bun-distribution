import type { ButtonInteraction, CommandInteraction } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { User } from "@/entities";
import { Database } from "@/services";
import { replyWithSimpleErrorEmbed, resolveDependency } from "@/utils/functions";

import { UserRole } from "../utils/enums";

export function RequireBotRole(role: UserRole) {
	const guard: GuardFunction<CommandInteraction | ButtonInteraction> = async (
		interaction,
		client,
		next,
		guardData
	) => {
		const db = await resolveDependency(Database);
		let authorized: boolean = true;
		if (role === UserRole.Administrator) {
			authorized = await db.get(User).isUserBotAdmin(interaction.user.id);
		}

		if (role === UserRole.Moderator) {
			authorized = await db.get(User).isBotModerator(interaction.user.id);
		}

		if (!authorized) {
			await replyWithSimpleErrorEmbed(
				interaction,
				"You do not have permission to execute this action."
			);

			return;
		}

		await next();
	};

	return guard;
}
