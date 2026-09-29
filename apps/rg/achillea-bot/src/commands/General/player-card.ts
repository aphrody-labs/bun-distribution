import { Category } from "@aphrody/utilities";
import type { CommandInteraction, User as DiscordUser } from "discord.js";
import { ApplicationCommandOptionType, AttachmentBuilder, MessageFlags } from "discord.js";

import { Discord, Injectable, Slash, SlashOption } from "@/decorators";
import { User } from "@/entities";
import { Database, PlayerCardService, UserService } from "@/services";
import { followUpWithErrorEmbed } from "@/utils/functions";

@Discord()
@Injectable()
@Category("General")
export default class PlayerCardCommand {
	constructor(
		private db: Database,
		private cardService: PlayerCardService,
		private userService: UserService
	) {}

	@Slash({
		description: "Génère ta carte joueur Achilléa (ou celle d'un autre joueur)",
		name: "player-card",
	})
	async playerCard(
		@SlashOption({
			description: "Le joueur ciblé (vide = toi)",
			name: "user",
			required: false,
			type: ApplicationCommandOptionType.User,
		})
		targetDiscordUser: DiscordUser | null,
		interaction: CommandInteraction
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const targetId = targetDiscordUser?.id ?? interaction.user.id;

		const targetUser = await this.db.get(User).findOne({ id: targetId });
		if (!targetUser) {
			try {
				await this.userService.getDiscordUser(targetId);
			} catch {
				followUpWithErrorEmbed(interaction, `Utilisateur \`${targetId}\` introuvable en base.`);

				return;
			}
			followUpWithErrorEmbed(
				interaction,
				`Utilisateur \`${targetId}\` introuvable en base. Connecte-toi au moins une fois sur le bot/site.`
			);

			return;
		}

		try {
			const buf = await this.cardService.generateCard(targetId);
			const attachment = new AttachmentBuilder(buf, { name: `player-${targetId}-card.png` });

			await interaction.followUp({
				content: `Carte joueur de **${targetUser.displayName || targetUser.username || targetId}**`,
				files: [attachment],
				flags: MessageFlags.Ephemeral,
			});
		} catch (err: any) {
			followUpWithErrorEmbed(
				interaction,
				err?.message ?? "Erreur lors de la génération de la carte joueur."
			);
		}
	}
}
