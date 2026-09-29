import type { CommandInteraction } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { ClanMember } from "@/entities";
import { Database } from "@/services";
import { replyWithSimpleErrorEmbed, resolveDependency } from "@/utils/functions";

import { ClanState } from "../utils/enums";

export const ClanEnabled: GuardFunction<CommandInteraction> = async (
	interaction,
	client,
	next,
	guardData
) => {
	const db = await resolveDependency(Database);
	const clanMember = await db
		.get(ClanMember)
		.findOne({ user: interaction.user.id }, { populate: ["clan", "clan.guild", "user"] });

	if (!clanMember) {
		await replyWithSimpleErrorEmbed(interaction, "Vous ne faites pas partie d'un Clan.");

		return;
	}

	if (clanMember.clan.state < ClanState.Approved) {
		await replyWithSimpleErrorEmbed(
			interaction,
			"Votre Clan n'est pas encore approuvé par les Administrateurs."
		);

		return;
	}

	guardData.clanMember = clanMember;
	guardData.clan = clanMember.clan;

	await next(guardData);
};
