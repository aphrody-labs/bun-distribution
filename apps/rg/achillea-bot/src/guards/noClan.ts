import type { CommandInteraction } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { Database } from "@/services";
import {
	hasActiveClanMembership,
	replyWithSimpleErrorEmbed,
	resolveDependency,
} from "@/utils/functions";

export const NoClan: GuardFunction<CommandInteraction> = async (
	interaction,
	client,
	next,
	guardData
) => {
	const db = await resolveDependency(Database);
	// Une adhésion à un Clan inactif ne bloque pas : seule une adhésion active compte.
	const alreadyInActiveClan = await hasActiveClanMembership(interaction.user.id, db.em);

	if (alreadyInActiveClan) {
		await replyWithSimpleErrorEmbed(interaction, "You are already in a Clan !");

		return;
	}

	await next();
};
