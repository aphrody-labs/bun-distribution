import { Category } from "@aphrody/utilities";
import type { CommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup } from "@/decorators";
import { Disabled } from "@/guards";
import { Database, Store } from "@/services";
import { followUpWithSuccessEmbed } from "@/utils/functions";

import { OAuthService } from "../../services/OAuthService";
import { TwitchService } from "../../services/Twitch";

@Discord()
@Injectable()
@Guard(Disabled)
@Category("General")
@SlashGroup("player")
export default class SettingsCommand {
	constructor(
		private oauth: OAuthService,
		private db: Database,
		private store: Store,
		private twitchService: TwitchService
	) {}

	@Slash({
		description: "Permet d'éditer ses informations et paramètres personnels",
		name: "settings",
	})
	async settings(interaction: CommandInteraction, client: Client, { localize }: InteractionData) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const twitchDetails = await this.twitchService.hasLinkedTwitch(interaction.user.id);

		if (!twitchDetails) {
			await interaction.followUp({
				embeds: [this.oauth.OAuthTwitchEmbed()],
				components: [
					this.oauth.OAuthButtons(await this.oauth.getTwitchOAuthUrl(interaction.user.id)) as any,
				],
			});

			return;
		}

		followUpWithSuccessEmbed(interaction, "Votre compte Twitch est déjà lié à cette application !");
	}
}
