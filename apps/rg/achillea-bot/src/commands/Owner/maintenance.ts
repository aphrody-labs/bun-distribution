import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guild } from "@aphrody/discordx";

import { adminManagerConfig } from "@/configs";
import { Discord, Guard, Slash, SlashGroup, SlashOption } from "@/decorators";
import { Disabled } from "@/guards";
import { setMaintenance, simpleSuccessEmbed } from "@/utils/functions";

@Discord()
@Guild(adminManagerConfig.adminGuildId)
@SlashGroup("owner")
export default class MaintenanceCommand {
	@Slash({
		name: "maintenance",
	})
	@Guard(Disabled)
	async maintenance(
		@SlashOption({ name: "state", type: ApplicationCommandOptionType.Boolean, required: true })
		state: boolean,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await setMaintenance(state);

		simpleSuccessEmbed(
			interaction,
			localize.COMMANDS.MAINTENANCE.EMBED.DESCRIPTION({
				state: state ? "on" : "off",
			})
		);
	}
}
