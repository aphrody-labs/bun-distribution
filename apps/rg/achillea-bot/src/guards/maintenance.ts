import { ButtonInteraction, CommandInteraction, ContextMenuCommandInteraction } from "discord.js";
import type { ArgsOf, GuardFunction } from "@aphrody/discordx";
import { SimpleCommandMessage } from "@aphrody/discordx";

import { getLocaleFromInteraction, L } from "@/i18n";
import { isDev, isInMaintenance, replyWithSimpleErrorEmbed, resolveUser } from "@/utils/functions";

/**
 * Prevent interactions from running when bot is in maintenance
 */
export const Maintenance: GuardFunction<ArgsOf<"messageCreate" | "interactionCreate">> = async (
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
		const user = resolveUser(arg);
		const maintenance = await isInMaintenance();

		if (maintenance && user?.id && !isDev(user.id)) {
			const locale = getLocaleFromInteraction(arg);
			const localizedReplyMessage = L[locale].GUARDS.MAINTENANCE();

			if (
				arg instanceof CommandInteraction ||
				arg instanceof SimpleCommandMessage ||
				arg instanceof ButtonInteraction
			)
				await replyWithSimpleErrorEmbed(arg as CommandInteraction, localizedReplyMessage);
		} else {
			return await next();
		}
	} else {
		return await next();
	}
};
