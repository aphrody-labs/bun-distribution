import { inject, injectable } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	type CommandInteraction,
	EmbedBuilder,
	MessageFlags,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { AdminReportGoalService } from "~/services/AdminReportGoalService";
import { SHENRON_THEME, SHENRON_SEPARATORS } from "~/lib/embeds";

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@SlashGroup({
	name: "report",
	description: "Signalement d'erreurs, bugs ou manques sur le site, le bot ou le canon",
})
@SlashGroup("report")
@injectable()
export class ReportCommands {
	constructor(@inject(AdminReportGoalService) private service: AdminReportGoalService) {}

	@Slash({
		name: "creer",
		description: "Signaler une erreur, un bug ou un manque (synchronisé en temps réel en Markdown et DB)",
	})
	async create(
		@SlashChoice({ name: "Site web (Next.js)", value: "site" })
		@SlashChoice({ name: "Bot Discord", value: "bot" })
		@SlashChoice({ name: "Wiki / Données", value: "wiki" })
		@SlashChoice({ name: "Doctrine Canon", value: "canon" })
		@SlashChoice({ name: "Databooks / OCR", value: "databook" })
		@SlashChoice({ name: "Autre", value: "other" })
		@SlashOption({
			name: "categorie",
			description: "Domaine du signalement",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		category: "site" | "bot" | "wiki" | "canon" | "databook" | "other",
		@SlashOption({
			name: "titre",
			description: "Titre clair et concis du problème",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		title: string,
		@SlashOption({
			name: "description",
			description: "Détails de l'erreur ou du manque",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		description: string,
		@SlashChoice({ name: "Critique (P0 - Bloquant)", value: "critical" })
		@SlashChoice({ name: "Majeur (P1 - Important)", value: "major" })
		@SlashChoice({ name: "Mineur (P2 - Défaut normal)", value: "minor" })
		@SlashChoice({ name: "Suggestion (P3 - Amélioration)", value: "suggestion" })
		@SlashOption({
			name: "severite",
			description: "Niveau d'impact",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		severity: "critical" | "major" | "minor" | "suggestion" | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		try {
			const rep = await this.service.createReport({
				userId: interaction.user.id,
				userTag: interaction.user.username,
				category,
				title,
				description,
				severity: severity ?? "minor",
			});

			const embed = new EmbedBuilder()
				.setColor(severity === "critical" ? 0xef4444 : severity === "major" ? 0xf97316 : 0x38bdf8)
				.setTitle(`🚨 Signalement #${rep.id} enregistré !`)
				.setDescription(
					[
						`**Catégorie :** \`${category.toUpperCase()}\``,
						`**Titre :** ${title}`,
						`**Description :** ${description}`,
						`**Sévérité :** \`${(severity ?? "minor").toUpperCase()}\``,
						"",
						SHENRON_SEPARATORS.solid,
						`• Synchronisé en DB (\`admin_reports\`)`,
						`• Inscrit dans \`docs/ADMIN-REPORTS.md\``,
						`• Transmis aux agents dans le salon admin.`,
					].join("\n")
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({ content: `❌ Erreur : ${e.message}` });
		}
	}

	@Slash({
		name: "liste",
		description: "Afficher les signalements en cours ou l'historique complet",
	})
	async list(
		@SlashChoice({ name: "Ouverts / En attente", value: "open" })
		@SlashChoice({ name: "Tous les signalements", value: "all" })
		@SlashChoice({ name: "Résolus uniquement", value: "resolved" })
		@SlashOption({
			name: "statut",
			description: "Filtrer par statut",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		status: string | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		const reports = this.service.listReports(status ?? "open");
		if (reports.length === 0) {
			await interaction.editReply({
				content: `✅ Aucun signalement correspondant trouvé (${status ?? "open"}).`,
			});
			return;
		}

		const lines = reports.slice(0, 8).map((r) => {
			const date = new Date(r.created_at).toLocaleDateString();
			return `**#${r.id} [${r.category.toUpperCase()}]** ${r.title} (\`${r.severity}\` · ${r.status})\n> ${r.description.slice(0, 100)}... *(par @${r.user_tag ?? r.user_id} le ${date})*`;
		});

		const embed = new EmbedBuilder()
			.setColor(SHENRON_THEME.saiyanBlue)
			.setTitle(`📋 Registre des Signalements (${reports.length})`)
			.setDescription(lines.join("\n\n").slice(0, 4096))
			.setFooter({ text: "Consultez docs/ADMIN-REPORTS.md pour le registre complet" });

		await interaction.editReply({ embeds: [embed] });
	}

	@Slash({
		name: "resoudre",
		description: "Marquer un signalement comme résolu avec notes d'intervention",
	})
	async resolve(
		@SlashOption({
			name: "id",
			description: "Numéro ID du signalement",
			type: ApplicationCommandOptionType.Integer,
			required: true,
		})
		id: number,
		@SlashOption({
			name: "notes",
			description: "Ce qui a été corrigé ou ajusté",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		notes: string,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		const rep = await this.service.resolveReport(id, notes, `@${interaction.user.username}`);
		if (!rep) {
			await interaction.editReply({ content: `❌ Signalement #${id} introuvable.` });
			return;
		}

		await interaction.editReply({
			content: `✅ **Signalement #${id} résolu avec succès !** Mis à jour en base et dans \`docs/ADMIN-REPORTS.md\`.`,
		});
	}
}

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@SlashGroup({
	name: "goal",
	description: "Définition des objectifs et feuille de route pour les agents de code",
})
@SlashGroup("goal")
@injectable()
export class GoalCommands {
	constructor(@inject(AdminReportGoalService) private service: AdminReportGoalService) {}

	@Slash({
		name: "fixer",
		description: "Déterminer un objectif prioritaire pour la prochaine session (synchronisé en Markdown)",
	})
	async setGoal(
		@SlashOption({
			name: "titre",
			description: "Titre clair de l'objectif",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		title: string,
		@SlashOption({
			name: "description",
			description: "Spécifications de ce qu'il faut faire",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		description: string,
		@SlashChoice({ name: "P0 (Priorité absolue / Urgence)", value: "p0" })
		@SlashChoice({ name: "P1 (Priorité haute)", value: "p1" })
		@SlashChoice({ name: "P2 (Normal)", value: "p2" })
		@SlashChoice({ name: "P3 (Secondaire / Backlog)", value: "p3" })
		@SlashOption({
			name: "priorite",
			description: "Niveau de priorité",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		priority: "p0" | "p1" | "p2" | "p3" | undefined,
		@SlashChoice({ name: "Prochaine session (next_session)", value: "next_session" })
		@SlashChoice({ name: "Session en cours", value: "session_current" })
		@SlashOption({
			name: "session_cible",
			description: "Fenêtre temporelle d'exécution",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		targetSession: string | undefined,
		@SlashChoice({ name: "Tous les agents (all_agents)", value: "all_agents" })
		@SlashChoice({ name: "Claude Code", value: "claude" })
		@SlashChoice({ name: "AGY (Antigravity)", value: "agy" })
		@SlashChoice({ name: "Codex", value: "codex" })
		@SlashOption({
			name: "assigne_a",
			description: "Agent ciblé",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		assignedTo: string | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		try {
			const goal = await this.service.createGoal({
				userId: interaction.user.id,
				userTag: interaction.user.username,
				title,
				description,
				priority: priority ?? "p1",
				targetSession: targetSession ?? "next_session",
				assignedTo: assignedTo ?? "all_agents",
			});

			const embed = new EmbedBuilder()
				.setColor(SHENRON_THEME.gold)
				.setTitle(`🎯 Objectif #${goal.id} programmé pour la session !`)
				.setDescription(
					[
						`**Titre :** ${title}`,
						`**Description :** ${description}`,
						`**Priorité :** \`${(priority ?? "p1").toUpperCase()}\``,
						`**Session cible :** \`${targetSession ?? "next_session"}\``,
						`**Assigné à :** \`${assignedTo ?? "all_agents"}\``,
						"",
						SHENRON_SEPARATORS.solid,
						`• Synchronisé en temps réel dans \`docs/GOALS.md\``,
						`• Enregistré en base (\`admin_goals\`)`,
						`• Pris en charge par les agents (Claude, AGY, Codex) dès la prochaine session.`,
					].join("\n")
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({ content: `❌ Erreur : ${e.message}` });
		}
	}

	@Slash({
		name: "liste",
		description: "Afficher les objectifs actifs ou l'historique complet",
	})
	async list(
		@SlashChoice({ name: "Objectifs actifs", value: "pending" })
		@SlashChoice({ name: "Tous les objectifs", value: "all" })
		@SlashChoice({ name: "Objectifs complétés", value: "completed" })
		@SlashOption({
			name: "statut",
			description: "Filtrer par statut",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		status: string | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		const goals = this.service.listGoals(status ?? "pending");
		if (goals.length === 0) {
			await interaction.editReply({
				content: `✅ Aucun objectif correspondant trouvé (${status ?? "pending"}).`,
			});
			return;
		}

		const lines = goals.slice(0, 8).map((g) => {
			const date = new Date(g.created_at).toLocaleDateString();
			return `**#${g.id} [${g.priority.toUpperCase()}]** ${g.title} (\`${g.target_session}\` · assigné à \`${g.assigned_to}\`)\n> ${g.description.slice(0, 110)}... *(statut: ${g.status})*`;
		});

		const embed = new EmbedBuilder()
			.setColor(SHENRON_THEME.kiGreen)
			.setTitle(`🎯 Feuille de Route & Objectifs (${goals.length})`)
			.setDescription(lines.join("\n\n").slice(0, 4096))
			.setFooter({ text: "Consultez docs/GOALS.md pour le plan complet" });

		await interaction.editReply({ embeds: [embed] });
	}

	@Slash({
		name: "accompli",
		description: "Marquer un objectif comme complété avec un bilan de session",
	})
	async complete(
		@SlashOption({
			name: "id",
			description: "Numéro ID de l'objectif",
			type: ApplicationCommandOptionType.Integer,
			required: true,
		})
		id: number,
		@SlashOption({
			name: "bilan",
			description: "Résumé des réalisations",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		notes: string | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		const goal = await this.service.completeGoal(id, notes);
		if (!goal) {
			await interaction.editReply({ content: `❌ Objectif #${id} introuvable.` });
			return;
		}

		await interaction.editReply({
			content: `🏆 **Objectif #${id} marqué comme accompli !** Mis à jour dans \`docs/GOALS.md\`.`,
		});
	}
}
