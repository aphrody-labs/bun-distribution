import { Category } from "@aphrody/utilities";
import type { CommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup } from "@/decorators";
import { ClanEnabled } from "@/guards";
import { Database } from "@/services";
import { createTeamManagerEmbed } from "@/utils/functions";

import { buildClanTeamsMenuButtonRow } from "../../utils/functions/components";

@Discord()
@Guard(ClanEnabled)
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class ClanTeamCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Manage your teams",
		name: "teams",
	})
	async teams(
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await interaction.followUp({
			embeds: [await createTeamManagerEmbed(clan, this.db)],
			components: [buildClanTeamsMenuButtonRow(clan)],
		});
	}
}
