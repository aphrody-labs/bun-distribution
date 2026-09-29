import type { CommandInteraction, User as DiscordUser } from "discord.js";
import { ApplicationCommandOptionType, escapeMarkdown, GuildMember } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guild } from "@aphrody/discordx";

import { adminManagerConfig } from "@/configs";
import { Discord, Guard, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { Blacklist, User } from "@/entities";
import { Disabled } from "@/guards";
import { Database } from "@/services";
import {
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	isDev,
	syncUser,
} from "@/utils/functions";

@Discord()
@Injectable()
@Guild(adminManagerConfig.adminGuildId)
@SlashGroup("owner")
export default class BlacklistCommand {
	constructor(private db: Database) {}

	@Slash({
		name: "blacklist-add",
	})
	@Guard(Disabled)
	async blacklistUser(
		@SlashOption({ name: "user", type: ApplicationCommandOptionType.User, required: true })
		user: DiscordUser,
		@SlashOption({ name: "reason", type: ApplicationCommandOptionType.String, required: true })
		reason: string,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply();
		const resolvedUser = user instanceof GuildMember ? user.user : (user as DiscordUser);

		if (!resolvedUser)
			return followUpWithErrorEmbed(interaction, "Impossible de traiter cet utilisateur");

		if (isDev(resolvedUser.id))
			return followUpWithErrorEmbed(
				interaction,
				"Impossible d'ajouter une développeur à la liste noire."
			);

		await syncUser(resolvedUser);

		const userEntity = await this.db.em.findOne(
			User,
			{ id: resolvedUser.id },
			{ refresh: true, populate: ["blacklist"] }
		);
		if (!userEntity)
			return followUpWithErrorEmbed(interaction, "Impossible de trouver cet utilisateur");

		if (userEntity.blacklist)
			return followUpWithErrorEmbed(
				interaction,
				`L'utilisateur ${resolvedUser.displayName} est déjà sur la liste noire`
			);

		const blacklikst = new Blacklist();
		blacklikst.reason = reason;

		userEntity.blacklist = blacklikst;
		try {
			await this.db.em.persist(blacklikst).flush();
		} catch (err) {
			console.error(err);

			return followUpWithErrorEmbed(
				interaction,
				"Erreur lors de la tentative d'ajout à la liste noire"
			);
		}

		followUpWithSuccessEmbed(
			interaction,
			`L'utilisateur ${escapeMarkdown(resolvedUser.displayName)} a été ajouté à la liste noire`
		);
	}

	@Slash({
		name: "blacklist-remove",
	})
	@Guard(Disabled)
	async blacklistRemoveUser(
		@SlashOption({ name: "user", type: ApplicationCommandOptionType.User, required: true })
		user: DiscordUser,
		@SlashOption({ name: "reason", type: ApplicationCommandOptionType.String, required: true })
		reason: string,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply();
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

		try {
			await this.db.em.remove(userEntity.blacklist).flush();
		} catch (err) {
			console.error(err);

			return followUpWithErrorEmbed(
				interaction,
				"Erreur lors de la tentative de retrait de la liste noire"
			);
		}

		followUpWithSuccessEmbed(
			interaction,
			`L'utilisateur ${escapeMarkdown(resolvedUser.displayName)} a été retiré de la liste noire`
		);
	}
}
