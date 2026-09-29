import { ButtonInteraction, CommandInteraction, ContextMenuCommandInteraction } from "discord.js";
import type { ArgsOf, GuardFunction } from "@aphrody/discordx";
import { SimpleCommandMessage } from "@aphrody/discordx";

import { User } from "@/entities";
import { Database } from "@/services";
import { replyWithSimpleErrorEmbed, resolveDependency, resolveUser } from "@/utils/functions";

export const Blacklist: GuardFunction<ArgsOf<"messageCreate" | "interactionCreate">> = async (
	arg,
	client,
	next
) => {
	if (
		arg instanceof CommandInteraction ||
		arg instanceof SimpleCommandMessage ||
		arg instanceof ContextMenuCommandInteraction ||
		arg instanceof ButtonInteraction
	) {
		const db = await resolveDependency(Database);
		const user = resolveUser(arg);
		if (!user) return;
		const isBlacklisted = await db.em.findOne(User, {
			id: user.id,
			blacklist: { $ne: null },
		});

		if (isBlacklisted) {
			if (
				arg instanceof CommandInteraction ||
				arg instanceof SimpleCommandMessage ||
				arg instanceof ButtonInteraction
			)
				await replyWithSimpleErrorEmbed(
					arg as CommandInteraction,
					"Vous n'êtes pas autorisé à effectuer cette action."
				);
		} else {
			return await next();
		}
	} else {
		return await next();
	}
};
