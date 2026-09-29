import { Category } from "@aphrody/utilities";
import type { CommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup } from "@/decorators";
import { Clan, Guild } from "@/entities";
import { GuildAdminOnly, GuildOnly } from "@/guards";
import { Database } from "@/services";
import { followUpWithErrorEmbed, guildSettingsEmbed } from "@/utils/functions";

import { buildGuildSettingsButtons } from "../../utils/functions/components";

@Discord()
@Guard(GuildOnly, GuildAdminOnly)
@Injectable()
@Category("General")
@SlashGroup({ description: "Gestion du bot sur votre serveur", name: "guild" })
@SlashGroup("guild")
export default class GuildSettingsCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Gestion du paramétrage du bot",
		name: "settings",
	})
	async guildSettings(
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			const guild = await this.db.em.findOne(Guild, { id: interaction.guildId });

			if (!guild) throw new Error("Cette commande doit être effectuée sur un serveur !");

			const clan = await this.db.em.findOne(Clan, { guild: interaction.guildId });

			// editReply (pas followUp) : résout le placeholder éphémère et garde le panneau
			// admin + ses boutons en éphémère (followUp les rendait publics).
			await interaction.editReply({
				embeds: [guildSettingsEmbed(guild, clan)],
				components: [buildGuildSettingsButtons(guild, clan !== null)],
			});
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`);
		}
	}
}
