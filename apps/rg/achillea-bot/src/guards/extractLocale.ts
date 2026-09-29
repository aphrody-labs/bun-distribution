import type { Interaction } from "discord.js";
import {
	ButtonInteraction,
	CommandInteraction,
	ContextMenuCommandInteraction,
	StringSelectMenuInteraction,
} from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";
import { SimpleCommandMessage } from "@aphrody/discordx";

import { getLocaleFromInteraction, L } from "@/i18n";

/**
 * Extract locale from any interaction and pass it as guard data
 */
export const ExtractLocale: GuardFunction<Interaction> = async (
	interaction,
	client,
	next,
	guardData
) => {
	if (
		interaction instanceof SimpleCommandMessage ||
		interaction instanceof CommandInteraction ||
		interaction instanceof ContextMenuCommandInteraction ||
		interaction instanceof StringSelectMenuInteraction ||
		interaction instanceof ButtonInteraction
	) {
		const sanitizedLocale = getLocaleFromInteraction(interaction as AllInteractions);

		guardData.sanitizedLocale = sanitizedLocale;
		guardData.localize = L[sanitizedLocale];
	}

	await next(guardData);
};
