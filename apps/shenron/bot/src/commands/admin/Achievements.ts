import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import { ApplicationCommandOptionType, MessageFlags, type CommandInteraction } from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { AchievementService } from "~/services/AchievementService";
import { brandedEmbed, errorEmbed, successEmbed, warningEmbed } from "~/lib/embeds";

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@SlashGroup({ name: "succes", description: "Admin: gestion des succès auto-déclenchés" })
@SlashGroup("succes")
@injectable()
export class AchievementAdmin {
	constructor(@inject(AchievementService) private ach: AchievementService) {}

	@Slash({ name: "set", description: "Créer ou éditer un trigger de succès" })
	async set(
		@SlashOption({
			name: "code",
			description: "Code du succès (ex: KAMEHAMEHA)",
			type: ApplicationCommandOptionType.String,
			required: true,
			maxLength: 64,
		})
		code: string,
		@SlashOption({
			name: "pattern",
			description: "Regex JavaScript à matcher dans les messages",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		pattern: string,
		@SlashOption({
			name: "description",
			description: "Description visible dans /succes list",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 200,
		})
		description: string | undefined,
		@SlashOption({
			name: "flags",
			description: "Flags regex (défaut: i)",
			type: ApplicationCommandOptionType.String,
			required: false,
			maxLength: 8,
		})
		flags: string | undefined,
		interaction: CommandInteraction
	) {
		try {
			new RegExp(pattern, flags ?? "i");
		} catch (err) {
			await interaction.reply({
				embeds: [errorEmbed("Regex invalide", (err as Error).message)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await this.ach.upsert({ code, pattern, description, flags });
		await interaction.reply({
			embeds: [
				successEmbed(
					`Trigger \`${code}\` enregistré`,
					`Pattern : \`/${pattern}/${flags ?? "i"}\`\nDescription : ${description ?? "*(n/a)*"}`
				),
			],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({ name: "list", description: "Lister tous les triggers" })
	async list(interaction: CommandInteraction) {
		const list = await this.ach.list();
		if (list.length === 0) {
			await interaction.reply({
				embeds: [
					brandedEmbed({
						title: "Triggers de succès",
						description: "*(aucun trigger configuré)*",
						kind: "muted",
					}),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const embed = brandedEmbed({
			title: `Triggers de succès (${list.length})`,
			description: list
				.toSorted((a, b) => a.code.localeCompare(b.code))
				.slice(0, 25)
				.map(
					(t) =>
						`**\`${t.code}\`** ${t.enabled ? "✅" : "🚫"}\n` +
						`  → \`/${t.pattern}/${t.flags ?? "i"}\`\n` +
						`  ${t.description ?? "—"}`
				)
				.join("\n\n"),
			kind: "info",
		});
		await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}

	@Slash({ name: "remove", description: "Supprimer définitivement un trigger" })
	async remove(
		@SlashOption({
			name: "code",
			description: "Code du trigger à supprimer",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		code: string,
		interaction: CommandInteraction
	) {
		await this.ach.remove(code);
		await interaction.reply({
			embeds: [successEmbed("Trigger supprimé", `\`${code}\` retiré.`)],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({ name: "enable", description: "Activer un trigger sans le recréer" })
	async enable(
		@SlashOption({
			name: "code",
			description: "Code du trigger",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		code: string,
		interaction: CommandInteraction
	) {
		const ok = await this.ach.setEnabled(code, true);
		await interaction.reply({
			embeds: [
				ok
					? successEmbed("Trigger activé", `\`${code}\` est désormais actif.`)
					: errorEmbed("Trigger introuvable", `Aucun trigger \`${code}\`.`),
			],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({ name: "disable", description: "Désactiver un trigger sans le supprimer" })
	async disable(
		@SlashOption({
			name: "code",
			description: "Code du trigger",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		code: string,
		interaction: CommandInteraction
	) {
		const ok = await this.ach.setEnabled(code, false);
		await interaction.reply({
			embeds: [
				ok
					? warningEmbed(
							"Trigger désactivé",
							`\`${code}\` ne se déclenchera plus jusqu'au prochain \`/succes enable\`.`
						)
					: errorEmbed("Trigger introuvable", `Aucun trigger \`${code}\`.`),
			],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({ name: "test", description: "Tester un trigger contre un texte d'exemple" })
	async test(
		@SlashOption({
			name: "code",
			description: "Code du trigger",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		code: string,
		@SlashOption({
			name: "texte",
			description: "Texte à tester contre la regex",
			type: ApplicationCommandOptionType.String,
			required: true,
			maxLength: 1500,
		})
		sample: string,
		interaction: CommandInteraction
	) {
		const result = await this.ach.test(code, sample);
		if (!result) {
			await interaction.reply({
				embeds: [errorEmbed("Trigger introuvable", `Aucun trigger \`${code}\`.`)],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.reply({
			embeds: [
				result.match
					? successEmbed(
							`Match ✅`,
							`Le pattern \`/${result.pattern}/${result.flags}\` **matche** le texte fourni.`
						)
					: warningEmbed(
							`Pas de match`,
							`Le pattern \`/${result.pattern}/${result.flags}\` ne matche pas.\n\n> ${sample.slice(0, 200)}`
						),
			],
			flags: MessageFlags.Ephemeral,
		});
	}
}
