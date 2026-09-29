import { Category } from "@aphrody/utilities";
import type { CommandInteraction, User as DiscordUser } from "discord.js";
import { ApplicationCommandOptionType, GuildMember } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashOption } from "@/decorators";
import { User } from "@/entities";
import { Database } from "@/services";
import { blacklistedUserEmbed, followUpWithErrorEmbed } from "@/utils/functions";

@Discord()
@Injectable()
@Category("General")
export default class BlacklistViewCommand {
	constructor(private db: Database) {}

	@Slash({
		name: "blacklist",
	})
	async fetchBlacklist(
		@SlashOption({ name: "user", type: ApplicationCommandOptionType.User, required: false })
		user: DiscordUser,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply();

		if (user) {
			const resolvedUser = user instanceof GuildMember ? user.user : (user as DiscordUser);
			if (!resolvedUser)
				return followUpWithErrorEmbed(interaction, "Impossible de traiter cet utilisateur");

			const userEntity = await this.db.em.findOne(
				User,
				{ id: resolvedUser.id },
				{ refresh: true, populate: ["blacklist"] }
			);
			if (!userEntity)
				return followUpWithErrorEmbed(interaction, "Impossible de trouver cet utilisateur");

			if (!userEntity.blacklist)
				return followUpWithErrorEmbed(
					interaction,
					`L'utilisateur ${resolvedUser.displayName} n'est pas sur la liste noire`
				);

			return await interaction.followUp({ embeds: [blacklistedUserEmbed(userEntity)] });
		}

		const blacklistedUsers = await this.db.em.find(User, { blacklist: { $ne: null } });

		if (blacklistedUsers.length === 0)
			return interaction.followUp({ content: "Il n'y a aucun utilisateur sur la liste noire." });

		const blacklistedUsersString = blacklistedUsers
			.map(
				(blacklistedUser) =>
					`- ${blacklistedUser.id}: ${blacklistedUser.displayName} (${blacklistedUser.username})`
			)
			.join("\n");

		await interaction.followUp({
			content: `Liste des utilisateurs sur la liste noire:\n${blacklistedUsersString}`,
		});
	}
}
