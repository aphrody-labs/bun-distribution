import { Category } from "@aphrody/utilities";
import type { CommandInteraction, User as DiscordUser } from "discord.js";
import { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } from "discord.js";

import { Discord, Injectable, Slash, SlashChoice, SlashOption } from "@/decorators";
import { Tournament } from "@/entities";
import { Database, PlayerNoteService } from "@/services";
import { PlayerNoteCategory, PlayerNoteSeverity, TournamentState } from "@/utils/enums";
import { syncUser } from "@/utils/functions";

/**
 * `/report` — signaler un joueur depuis Discord.
 *
 * Le cadrage demandait que les organisateurs puissent « noter dans un espace dédié » ce
 * qu'ils ont à dire d'un joueur pendant un tournoi. La commande écrit dans la même
 * table que le dashboard (`player_note`) et le registre Drive : trois portes, un seul
 * dossier.
 *
 * Réponse toujours éphémère : un signalement affiché dans le salon serait une mise au
 * pilori, exactement ce que l'espace privé doit éviter.
 */
@Discord()
@Injectable()
@Category("General")
export default class ReportCommand {
	constructor(
		private db: Database,
		private notes: PlayerNoteService
	) {}

	@Slash({
		description: "Signaler un joueur au staff (comportement, triche, absence…)",
		name: "report",
	})
	async report(
		@SlashOption({
			description: "Le joueur concerné",
			name: "joueur",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		targetUser: DiscordUser,

		@SlashOption({
			description: "Ce que tu as constaté",
			name: "details",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		details: string,

		// Les choix évitent une saisie libre qu'il faudrait ensuite normaliser.
		@SlashChoice({ name: "Comportement", value: PlayerNoteCategory.BEHAVIOR })
		@SlashChoice({ name: "Triche suspectée", value: PlayerNoteCategory.CHEATING })
		@SlashChoice({ name: "Absence / no-show", value: PlayerNoteCategory.NO_SHOW })
		@SlashChoice({ name: "Litige de score", value: PlayerNoteCategory.SCORE_DISPUTE })
		@SlashChoice({ name: "Positif", value: PlayerNoteCategory.POSITIVE })
		@SlashChoice({ name: "Autre", value: PlayerNoteCategory.OTHER })
		@SlashOption({
			description: "Type de signalement",
			name: "categorie",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		category: PlayerNoteCategory | undefined,

		@SlashChoice({ name: "Info", value: PlayerNoteSeverity.INFO })
		@SlashChoice({ name: "Attention", value: PlayerNoteSeverity.WARNING })
		@SlashChoice({ name: "Grave", value: PlayerNoteSeverity.SERIOUS })
		@SlashOption({
			description: "Gravité",
			name: "gravite",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		severity: PlayerNoteSeverity | undefined,

		@SlashOption({
			description: "Identifiant du tournoi concerné (laisser vide hors tournoi)",
			name: "tournoi",
			required: false,
			type: ApplicationCommandOptionType.Integer,
		})
		tournamentId: number | undefined,

		interaction: CommandInteraction
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (targetUser.bot) {
			await interaction.editReply({ content: "On ne signale pas un bot." });
			return;
		}

		if (targetUser.id === interaction.user.id) {
			await interaction.editReply({ content: "Tu ne peux pas te signaler toi-même." });
			return;
		}

		// L'auteur comme la cible doivent exister en base : un joueur signalé qui n'a
		// jamais ouvert le site ne doit pas faire échouer le signalement.
		await syncUser(interaction.user);
		await syncUser(targetUser);

		try {
			await this.notes.assertCanAccess(interaction.user.id, tournamentId ?? null);
		} catch {
			await interaction.editReply({
				content:
					"Cette commande est réservée au staff et aux organisateurs de tournoi. " +
					"Si tu es TO, précise l'identifiant de ton tournoi dans l'option `tournoi`.",
			});
			return;
		}

		let tournamentName: string | null = null;
		if (tournamentId) {
			const tournament = await this.db.em.findOne(Tournament, { id: tournamentId });
			if (!tournament) {
				await interaction.editReply({
					content: `Aucun tournoi ne porte l'identifiant ${tournamentId}.`,
				});
				return;
			}
			tournamentName = tournament.name;
		}

		try {
			const note = await this.notes.create({
				targetId: targetUser.id,
				authorId: interaction.user.id,
				tournamentId: tournamentId ?? null,
				category,
				severity,
				content: details,
			});

			const embed = new EmbedBuilder()
				.setTitle("Signalement enregistré")
				.setDescription(
					`Ton signalement sur **${targetUser.displayName || targetUser.username}** est visible du staff.`
				)
				.addFields(
					{ name: "Gravité", value: this.severityLabel(note.severity), inline: true },
					{ name: "Catégorie", value: this.categoryLabel(note.category), inline: true },
					{ name: "Tournoi", value: tournamentName ?? "—", inline: true }
				)
				.setColor(this.severityColor(note.severity))
				.setFooter({ text: "Visible du staff uniquement — le joueur n'en est pas informé." });

			if (note.docsUrl) {
				embed.addFields({ name: "Registre", value: `[Ouvrir le document](${note.docsUrl})` });
			}

			await interaction.editReply({ embeds: [embed] });
		} catch (error) {
			await interaction.editReply({
				content: `Signalement impossible : ${(error as Error)?.message ?? "erreur inconnue"}`,
			});
		}
	}

	/** Liste les tournois en cours, pour retrouver l'identifiant à passer à `/report`. */
	@Slash({
		description: "Affiche les identifiants des tournois en cours (pour /report)",
		name: "report-tournois",
	})
	async listTournaments(interaction: CommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const tournaments = await this.db.em.find(
			Tournament,
			{
				internalState: {
					$in: [TournamentState.PREREGISTERING, TournamentState.PREPARING, TournamentState.ONGOING],
				},
			},
			{ orderBy: { startsAt: "ASC" }, limit: 25 }
		);

		if (tournaments.length === 0) {
			await interaction.editReply({ content: "Aucun tournoi ouvert actuellement." });
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle("Tournois en cours")
			.setDescription(
				tournaments.map((t) => `\`${t.id}\` — ${t.name} (${t.internalState})`).join("\n")
			)
			.setFooter({ text: "Utilise l'identifiant dans /report tournoi:<id>" });

		await interaction.editReply({ embeds: [embed] });
	}

	private categoryLabel(category: PlayerNoteCategory): string {
		switch (category) {
			case PlayerNoteCategory.BEHAVIOR:
				return "Comportement";
			case PlayerNoteCategory.CHEATING:
				return "Triche suspectée";
			case PlayerNoteCategory.NO_SHOW:
				return "Absence / no-show";
			case PlayerNoteCategory.SCORE_DISPUTE:
				return "Litige de score";
			case PlayerNoteCategory.POSITIVE:
				return "Positif";
			default:
				return "Autre";
		}
	}

	private severityLabel(severity: PlayerNoteSeverity): string {
		switch (severity) {
			case PlayerNoteSeverity.WARNING:
				return "Attention";
			case PlayerNoteSeverity.SERIOUS:
				return "Grave";
			default:
				return "Info";
		}
	}

	private severityColor(severity: PlayerNoteSeverity): number {
		switch (severity) {
			case PlayerNoteSeverity.WARNING:
				return 0xf59e0b;
			case PlayerNoteSeverity.SERIOUS:
				return 0xef4444;
			default:
				return 0x3b82f6;
		}
	}
}
