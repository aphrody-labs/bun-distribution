import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { EmbedBuilder, type CommandInteractionOption, type Interaction } from "discord.js";
import { DatabaseService } from "~/db/index";
import { actionLogs } from "~/db/schema";
import { logger } from "~/lib/logger";
import { auditInputs, neutralize, type InputAudit } from "~/lib/input-audit";
import { LogService } from "~/services/LogService";
import { SettingsService } from "~/services/SettingsService";

/** Options d'une commande à plat (`groupe sous-commande option`). */
function flattenOptions(
	options: readonly CommandInteractionOption[],
	prefix = ""
): Array<{ name: string; value: unknown }> {
	return options.flatMap((o) =>
		o.options?.length
			? flattenOptions(o.options, `${prefix}${o.name} `)
			: [{ name: `${prefix}${o.name}`, value: o.value ?? o.user?.id ?? o.channel?.id ?? o.role?.id }]
	);
}

/** Entrées libres d'une interaction : options de commande ou champs de modale. */
function entriesOf(interaction: Interaction): Array<{ name: string; value: unknown }> {
	if (interaction.isChatInputCommand()) return flattenOptions(interaction.options.data);
	if (interaction.isModalSubmit()) {
		return interaction.fields.fields.map((f) => ({
			name: f.customId,
			value: "value" in f ? f.value : undefined,
		}));
	}
	return [];
}

/**
 * Trace chaque interaction Discord (slash command, context menu, button) dans
 * la table `action_logs` avec `action = "interaction"`. Permet au dashboard de
 * lire la dernière interaction (`/api/stats/interaction/last`) ainsi que le
 * journal d'audit complet par filtrage.
 *
 * Les `meta` contiennent JSON :
 *   { type, name, options }
 *
 * Insertion en best-effort — un échec d'insert ne casse pas l'exécution de la
 * commande.
 */
@Discord()
@Bot("shenron")
@injectable()
export class InteractionLogEvent {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(LogService) private logs: LogService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	@On({ event: "interactionCreate" })
	async log([interaction]: ArgsOf<"interactionCreate">) {
		try {
			let name = "unknown";
			let type = "unknown";
			if (interaction.isChatInputCommand()) {
				name = interaction.commandName;
				type = "chat";
			} else if (interaction.isMessageContextMenuCommand()) {
				name = interaction.commandName;
				type = "context.message";
			} else if (interaction.isUserContextMenuCommand()) {
				name = interaction.commandName;
				type = "context.user";
			} else if (interaction.isButton()) {
				name = interaction.customId;
				type = "button";
			} else if (interaction.isAnySelectMenu()) {
				name = interaction.customId;
				type = "select";
			} else if (interaction.isModalSubmit()) {
				name = interaction.customId;
				type = "modal";
			} else if (interaction.isAutocomplete()) {
				name = interaction.commandName;
				type = "autocomplete";
			} else {
				return;
			}

			// Analyse des entrées : les options et champs libres sont journalisés
			// (tronqués) et notés ; au-delà du seuil, la commande part dans le salon
			// bot. Avant, seul le NOM de la commande était gardé : impossible de
			// relire après coup ce qu'un joueur avait tapé pour contourner un jeu.
			const entries = entriesOf(interaction);
			const audit = auditInputs(entries);
			const meta = JSON.stringify({
				type,
				name,
				channelId: interaction.channelId,
				guildId: interaction.guildId,
				...(entries.length
					? { options: entries.map((e) => ({ name: e.name, value: neutralize(e.value, 120) })) }
					: {}),
				...(audit.score > 0 ? { audit } : {}),
			});
			void this.report(interaction, type, name, entries, audit);

			await this.dbs.db.insert(actionLogs).values({
				userId: interaction.user.id,
				moderatorId: null,
				action: "interaction",
				reason: null,
				meta,
			});
		} catch (err) {
			logger.debug({ err }, "interaction log insert failed");
		}
	}

	/** Publication dans le salon bot : entrées suspectes, ou toutes si demandé. */
	private async report(
		interaction: Interaction,
		type: string,
		name: string,
		entries: Array<{ name: string; value: unknown }>,
		audit: InputAudit
	) {
		try {
			if (type === "autocomplete") return;
			const threshold = await this.settings.getInt("logs.commands.alert_score", 4);
			const suspicious = audit.score >= threshold;
			if (!suspicious && !(type === "chat" && (await this.settings.getBool("logs.commands.all", false)))) {
				return;
			}
			const embed = new EmbedBuilder()
				.setColor(suspicious ? 0xef4444 : 0xf38418)
				.setTitle(suspicious ? `Entrée suspecte · /${name}` : `/${name}`)
				.addFields(
					{ name: "Membre", value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
					{ name: "Salon", value: interaction.channelId ? `<#${interaction.channelId}>` : "—", inline: true },
					{ name: "Type", value: type, inline: true }
				)
				.setTimestamp(new Date());
			if (entries.length) {
				embed.addFields({
					name: "Entrées",
					value: entries
						.map((e) => `**${neutralize(e.name, 40)}** : ${neutralize(e.value, 180)}`)
						.join("\n")
						.slice(0, 1024),
				});
			}
			if (audit.findings.length) {
				embed.addFields({
					name: `Analyse · score ${audit.score}`,
					value: audit.findings.map((f) => `\`${f.code}\` ${neutralize(f.detail, 150)}`).join("\n").slice(0, 1024),
				});
			}
			await this.logs.send(interaction.client, "commands", embed);
		} catch (err) {
			logger.debug({ err }, "commands log failed");
		}
	}
}
