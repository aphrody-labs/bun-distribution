import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	MessageFlags,
	type CommandInteraction,
	type User,
} from "discord.js";
import { sql, eq } from "drizzle-orm";
import { GuildOnly } from "~/guards/GuildOnly";
import { userTransformer } from "~/lib/slash-user";
import { DatabaseService } from "~/db/index";
import { users } from "~/db/schema";
import { SettingsService } from "~/services/SettingsService";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { AchievementService } from "~/services/AchievementService";
import { brandedEmbed, errorEmbed, successEmbed } from "~/lib/embeds";

/**
 * Outils admin transverses : reload des caches runtime, stats DB, reset
 * complet d'un membre. L'accès est défini par les règles persistées du dashboard.
 */
@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@SlashGroup({
	name: "admin",
	description: "Admin: outils transverses (reload caches, stats DB, reset membre)",
})
@SlashGroup("admin")
@injectable()
export class AdminCommands {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(SettingsService) private settings: SettingsService,
		@inject(MessageTemplateService) private templates: MessageTemplateService,
		@inject(AchievementService) private ach: AchievementService
	) {}

	@Slash({
		name: "reload",
		description: "Recharger tous les caches runtime (settings, templates, succès)",
	})
	async reload(interaction: CommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const t0 = Date.now();
		this.settings.invalidate();
		await this.templates.invalidate();
		await this.ach.refresh();
		await interaction.editReply({
			embeds: [
				successEmbed(
					"Caches rechargés",
					`Settings, templates et triggers de succès rechargés en ${Date.now() - t0} ms.`
				),
			],
		});
	}

	@Slash({ name: "db-stats", description: "Statistiques rapides de la base SQLite" })
	async dbStats(interaction: CommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const tables = [
			"users",
			"inventory",
			"achievements",
			"fusions",
			"warns",
			"jails",
			"tickets",
			"giveaways",
			"action_logs",
			"shop_items",
			"level_rewards",
			"achievement_triggers",
			"guild_settings",
			"message_templates",
			"db_characters",
			"db_planets",
		];
		const fields: { name: string; value: string; inline: boolean }[] = [];
		for (const t of tables) {
			try {
				const row = this.dbs.sqlite.query(`SELECT COUNT(*) AS c FROM "${t}"`).get() as {
					c: number;
				} | null;
				fields.push({ name: t, value: String(row?.c ?? 0), inline: true });
			} catch {
				fields.push({ name: t, value: "—", inline: true });
			}
		}
		// Page size + total pages → taille DB
		let dbSize = "—";
		try {
			const size = this.dbs.sqlite
				.query("SELECT page_count * page_size AS s FROM pragma_page_count(), pragma_page_size()")
				.get() as { s: number } | null;
			const bytes = Number(size?.s ?? 0);
			dbSize =
				bytes > 1024 * 1024
					? `${(bytes / 1024 / 1024).toFixed(1)} MB`
					: `${Math.round(bytes / 1024)} KB`;
		} catch {}

		const embed = brandedEmbed({
			title: "📊 Stats DB SQLite",
			description: `Fichier : **${dbSize}**`,
			kind: "info",
		}).addFields(fields.slice(0, 25));
		await interaction.editReply({ embeds: [embed] });
	}

	@Slash({
		name: "reset-user",
		description:
			"DANGER: supprimer entièrement un membre de la DB (cascade XP/zeni/inventaire/succès)",
	})
	async resetUser(
		@SlashOption(
			{
				name: "membre",
				description: "Membre à wipe",
				type: ApplicationCommandOptionType.User,
				required: true,
			},
			userTransformer
		)
		target: User,
		@SlashOption({
			name: "confirm",
			description: "Tapez 'CONFIRM' pour valider la suppression irréversible",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		confirm: string,
		interaction: CommandInteraction
	) {
		if (confirm !== "CONFIRM") {
			await interaction.reply({
				embeds: [
					errorEmbed(
						"Confirmation invalide",
						"Tape exactement `CONFIRM` (en majuscules) pour valider."
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const result = await this.dbs.db
			.delete(users)
			.where(eq(users.id, target.id))
			.returning({ id: users.id });
		await interaction.reply({
			embeds: [
				result.length > 0
					? successEmbed(
							"Membre supprimé",
							`<@${target.id}> et toutes ses données (XP, zeni, inventaire, succès) ont été supprimés.\n\nLes logs modération sont conservés.`
						)
					: brandedEmbed({
							title: "Membre absent",
							description: `<@${target.id}> n'avait aucune donnée en base.`,
							kind: "muted",
						}),
			],
			flags: MessageFlags.Ephemeral,
		});
	}
}
