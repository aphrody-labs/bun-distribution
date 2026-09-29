import type { ButtonInteraction } from "discord.js";
import type { GuardFunction } from "@aphrody/discordx";

import { Clan } from "@/entities";
import { Database } from "@/services";
import { followUpWithErrorEmbed, resolveDependency } from "@/utils/functions";

import { ClanState } from "../utils/enums";

export const ClanApprove: GuardFunction<ButtonInteraction> = async (
	interaction,
	client,
	next,
	guardData
) => {
	await interaction.deferUpdate();

	const [, clanId] = interaction.customId.split(":");

	const db = await resolveDependency(Database);

	const clan = await db.get(Clan).findOne({ id: Number(clanId) }, { populate: ["guild"] });

	if (!clan || clan.state === ClanState.Approved) {
		await followUpWithErrorEmbed(interaction, `This Clan has already been handled.`, true);

		await interaction.message.delete();

		return;
	}

	guardData.clan = clan;
	await next(guardData);
};
