import { Category } from "@aphrody/utilities";
import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, AttachmentBuilder, MessageFlags } from "discord.js";

import { Discord, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { Clan } from "@/entities";
import { ClanPosterService, ClanService, Database } from "@/services";
import { UserRole } from "@/utils/enums";
import { followUpWithErrorEmbed, normalizeNames } from "@/utils/functions";

@Discord()
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class ClanPosterCommand {
	constructor(
		private db: Database,
		private posterService: ClanPosterService,
		private clanService: ClanService
	) {}

	@Slash({
		description: "Génère l'affiche officielle d'un clan",
		name: "poster",
	})
	async poster(
		@SlashOption({
			description: "Le sigle du Clan ciblé (vide = ton clan)",
			name: "sigle",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		sigle: string,
		interaction: CommandInteraction
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		let targetClan: Clan | null = null;
		if (sigle) {
			const normalizedShortName = normalizeNames(sigle);
			targetClan = await this.db.get(Clan).findOne({ normalizedShortName });
			if (!targetClan) {
				followUpWithErrorEmbed(interaction, `Le Clan avec le sigle "${sigle}" n'existe pas.`);

				return;
			}
		} else {
			const callerMember = await this.clanService.getMember(interaction.user.id);
			if (!callerMember) {
				followUpWithErrorEmbed(interaction, "Vous n'êtes pas membre d'un Clan. Précisez un sigle.");

				return;
			}
			targetClan = callerMember.clan;
		}

		const callerMember = await this.clanService.getMember(interaction.user.id);
		const { User } = await import("@/entities");
		const callerUser = await this.db.get(User).findOne({ id: interaction.user.id });
		const isStaff =
			callerUser?.role === UserRole.Administrator ||
			callerUser?.role === UserRole.SuperAdministrator;
		const isClanMember = callerMember?.clan.id === targetClan.id;

		if (!isStaff && !isClanMember) {
			followUpWithErrorEmbed(
				interaction,
				"Vous devez être membre du Clan ciblé ou staff pour générer cette affiche."
			);

			return;
		}

		try {
			const buf = await this.posterService.generatePoster(targetClan.id);
			const attachment = new AttachmentBuilder(buf, { name: `clan-${targetClan.id}-poster.png` });

			await interaction.followUp({
				content: `Affiche officielle du Clan **${targetClan.name}** [${targetClan.shortenedName}]`,
				files: [attachment],
				flags: MessageFlags.Ephemeral,
			});
		} catch (err: any) {
			followUpWithErrorEmbed(
				interaction,
				err?.message ?? "Erreur lors de la génération de l'affiche."
			);
		}
	}
}
