import { Category } from "@aphrody/utilities";
import type { CommandInteraction } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { urlsConfig } from "@/configs";
import { Discord, Injectable, Slash } from "@/decorators";

@Discord()
@Injectable()
@Category("General")
export default class WebsiteCommand {
	constructor() {}

	@Slash({
		description: "Envoie le lien vers le site web d'Achillea",
		name: "website",
	})
	async website(interaction: CommandInteraction, client: Client, { localize }: InteractionData) {
		await interaction.deferReply();

		await interaction.followUp({
			content: `Le site web d'Achillea est joignable à l'adresse suivante : ${urlsConfig.website}`,
		});
	}
}
