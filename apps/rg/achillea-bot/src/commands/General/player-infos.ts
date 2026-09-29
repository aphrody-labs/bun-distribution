import { Category } from "@aphrody/utilities";
import type { ButtonBuilder, CommandInteraction, GuildMember } from "discord.js";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	Colors,
	escapeMarkdown,
	MessageFlags,
	User as DiscordUser,
} from "discord.js";
import type { Client } from "@aphrody/discordx";

import { Discord, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { ClanMember, ClanMemberHistory, User } from "@/entities";
import { Database } from "@/services";
import { buildUserEmbed, followUpWithErrorEmbed } from "@/utils/functions";

import { buildClanHistoryButton, buildInviteToClanButton } from "../../utils/functions/components";

@Discord()
@Injectable()
@Category("General")
@SlashGroup({ description: "Player commands", name: "player" })
@SlashGroup("player")
export default class PlayerInfosCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Récupère les informations d'un joueur",
		name: "infos",
	})
	async infos(
		@SlashOption({
			description: "Utilisateur dont vous cherchez les informations",
			name: "utilisateur",
			required: false,
			type: ApplicationCommandOptionType.User,
		})
		user: GuildMember,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		try {
			// cible : l'utilisateur passé en option, sinon l'appelant
			const targetDiscordUser: DiscordUser = user
				? user instanceof DiscordUser
					? user
					: user.user
				: interaction.user;

			const targetUser = await this.db.get(User).findOne({ id: targetDiscordUser.id });
			if (!targetUser) {
				followUpWithErrorEmbed(
					interaction,
					user
						? `L'utilisateur ${escapeMarkdown(targetDiscordUser.displayName)} n'a pas de profil joueur actif.`
						: "Tu n'as pas encore de profil joueur actif. Connecte-toi au moins une fois sur le bot/site."
				);

				return;
			}

			const embed = await buildUserEmbed(targetUser, client, "Infos", Colors.Blue);

			const hasCareer = Boolean(
				(await this.db.em.findOne(ClanMember, { user: targetUser })) ||
				(await this.db.em.findOne(ClanMemberHistory, { user: targetUser }))
			);

			await interaction.followUp({
				embeds: [embed],
				components: [
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						buildInviteToClanButton(targetUser.id),
						buildClanHistoryButton(targetUser.id, !hasCareer)
					) as any,
				],
			});
		} catch (err: unknown) {
			console.error("[player infos] échec:", err);
			followUpWithErrorEmbed(
				interaction,
				err instanceof Error
					? err.message
					: "Erreur lors de la récupération des informations du joueur."
			);
		}
	}
}
