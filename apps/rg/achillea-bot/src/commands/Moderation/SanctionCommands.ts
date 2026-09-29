import type { CommandInteraction, User as DiscordUser } from "discord.js";
import {
	ApplicationCommandOptionType,
	DiscordAPIError,
	EmbedBuilder,
	Colors,
	GuildMember,
	escapeMarkdown,
	userMention,
} from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guild } from "@aphrody/discordx";

import { adminManagerConfig } from "@/configs";
import { Discord, Guard, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { CASLGuard } from "@/guards";
import { SanctionService } from "@/services";
import { SanctionType } from "@/utils/enums";
import { followUpWithErrorEmbed, followUpWithSuccessEmbed, isDev } from "@/utils/functions";

// =============================================================================
// Duration parser  —  supports 30s, 15m, 2h, 7d
// =============================================================================

function parseDuration(raw: string): number | null {
	const match = raw.trim().match(/^(\d+)([smhd])$/);
	if (!match) return null;
	const value = parseInt(match[1], 10);
	const unit = match[2];
	const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
	return value * multiplier[unit];
}

const MAX_DISCORD_TIMEOUT_SEC = 2_419_200; // 28 days

function formatDuration(sec: number): string {
	if (sec >= 86400) return `${Math.round(sec / 86400)}j`;
	if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
	if (sec >= 60) return `${Math.round(sec / 60)}m`;
	return `${sec}s`;
}

// =============================================================================
// Helpers
// =============================================================================

function resolveDiscordUser(raw: DiscordUser | GuildMember): DiscordUser {
	return raw instanceof GuildMember ? raw.user : raw;
}

// =============================================================================
// Command class
// =============================================================================

@Discord()
@Injectable()
@Guild(adminManagerConfig.adminGuildId)
@SlashGroup({ name: "sanction", description: "Gestion des sanctions de modération" })
@SlashGroup("sanction")
export default class SanctionCommands {
	constructor(private sanctionService: SanctionService) {}

	// -------------------------------------------------------------------------
	// /sanction warn
	// -------------------------------------------------------------------------

	@Slash({ name: "warn", description: "Avertir un utilisateur" })
	@Guard(CASLGuard("moderate", "Sanction"))
	async warn(
		@SlashOption({
			name: "user",
			description: "Utilisateur à avertir",
			type: ApplicationCommandOptionType.User,
			required: true,
		})
		rawUser: DiscordUser | GuildMember,
		@SlashOption({
			name: "reason",
			description: "Raison de l'avertissement",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		reason: string,
		@SlashOption({
			name: "evidence",
			description: "Preuve / note libre (optionnel)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		evidence: string | undefined,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply();

		const target = resolveDiscordUser(rawUser);

		if (isDev(target.id)) {
			return followUpWithErrorEmbed(interaction, "Impossible de sanctionner un développeur.");
		}

		if (target.id === interaction.user.id) {
			return followUpWithErrorEmbed(interaction, "Vous ne pouvez pas vous sanctionner vous-même.");
		}

		const guildId = interaction.guildId!;

		let sanction;
		try {
			sanction = await this.sanctionService.issue({
				type: SanctionType.Warn,
				userId: target.id,
				guildId,
				reason,
				issuedBy: interaction.user.id,
				evidence: evidence ? [{ note: evidence }] : null,
			});
		} catch (err) {
			console.error("[SanctionCommands/warn]", err);
			return followUpWithErrorEmbed(interaction, "Erreur lors de l'émission de la sanction.");
		}

		// Evaluate auto-escalation
		let escalationNote: string | null = null;
		try {
			const escalation = await this.sanctionService.escalate(
				target.id,
				guildId,
				interaction.user.id
			);
			if (escalation) {
				await this.sanctionService.applyDiscordEffect(escalation);
				const label = escalation.type === SanctionType.Ban ? "ban" : "mute";
				const dur = escalation.durationSec ? ` ${formatDuration(escalation.durationSec)}` : "";
				const count = escalation.reason?.match(/(\d+) avertissements/)?.[1] ?? "?";
				escalationNote = `⚠️ ${count} warns actifs → ${label}${dur} automatique (ID \`${escalation.id}\`)`;
			}
		} catch (err) {
			// Escalade non bloquante
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("[SanctionCommands/warn] escalade échouée:", msg);
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Yellow)
			.setTitle("⚠️ Avertissement émis")
			.addFields(
				{
					name: "Utilisateur",
					value: `${userMention(target.id)} (${escapeMarkdown(target.username)})`,
					inline: true,
				},
				{ name: "Raison", value: reason, inline: false },
				{ name: "ID sanction", value: `\`${sanction.id}\``, inline: true }
			)
			.setTimestamp();

		if (escalationNote) {
			embed.addFields({ name: "Escalade automatique", value: escalationNote, inline: false });
		}

		await interaction.followUp({ embeds: [embed] });
	}

	// -------------------------------------------------------------------------
	// /sanction mute
	// -------------------------------------------------------------------------

	@Slash({ name: "mute", description: "Rendre silencieux un utilisateur" })
	@Guard(CASLGuard("moderate", "Sanction"))
	async mute(
		@SlashOption({
			name: "user",
			description: "Utilisateur à mute",
			type: ApplicationCommandOptionType.User,
			required: true,
		})
		rawUser: DiscordUser | GuildMember,
		@SlashOption({
			name: "reason",
			description: "Raison",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		reason: string,
		@SlashOption({
			name: "duration",
			description: "Durée (ex: 30m, 2h, 7d) — max 28j",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		durationRaw: string,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply();

		const target = resolveDiscordUser(rawUser);

		if (isDev(target.id)) {
			return followUpWithErrorEmbed(interaction, "Impossible de sanctionner un développeur.");
		}

		if (target.id === interaction.user.id) {
			return followUpWithErrorEmbed(interaction, "Vous ne pouvez pas vous sanctionner vous-même.");
		}

		if (target.bot) {
			return followUpWithErrorEmbed(interaction, "Impossible de mute un bot.");
		}

		const durationSec = parseDuration(durationRaw);
		if (!durationSec) {
			return followUpWithErrorEmbed(
				interaction,
				`Format de durée invalide : \`${durationRaw}\`. Exemples valides : \`30m\`, \`2h\`, \`7d\`.`
			);
		}
		if (durationSec > MAX_DISCORD_TIMEOUT_SEC) {
			return followUpWithErrorEmbed(
				interaction,
				`La durée maximale d'un mute Discord est de 28 jours (2 419 200 secondes).`
			);
		}

		const guildId = interaction.guildId!;

		let sanction;
		try {
			sanction = await this.sanctionService.issue({
				type: SanctionType.Mute,
				userId: target.id,
				guildId,
				reason,
				durationSec,
				issuedBy: interaction.user.id,
			});
		} catch (err) {
			console.error("[SanctionCommands/mute]", err);
			return followUpWithErrorEmbed(interaction, "Erreur lors de l'émission de la sanction.");
		}

		try {
			await this.sanctionService.applyDiscordEffect(sanction);
		} catch (err) {
			if (err instanceof DiscordAPIError) {
				return followUpWithErrorEmbed(
					interaction,
					`Sanction enregistrée (\`${sanction.id}\`) mais effet Discord échoué : ${err.message}`
				);
			}
			console.error("[SanctionCommands] effet Discord inattendu:", err);
			return followUpWithErrorEmbed(
				interaction,
				`Sanction enregistrée (\`${sanction.id}\`) mais une erreur inattendue est survenue lors de l'effet Discord.`
			);
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle("🔇 Mute appliqué")
			.addFields(
				{
					name: "Utilisateur",
					value: `${userMention(target.id)} (${escapeMarkdown(target.username)})`,
					inline: true,
				},
				{ name: "Durée", value: formatDuration(durationSec), inline: true },
				{ name: "Raison", value: reason, inline: false },
				{ name: "ID sanction", value: `\`${sanction.id}\``, inline: true },
				{
					name: "Expire le",
					value: sanction.expiresAt
						? `<t:${Math.floor(sanction.expiresAt.getTime() / 1000)}:F>`
						: "—",
					inline: true,
				}
			)
			.setTimestamp();

		await interaction.followUp({ embeds: [embed] });
	}

	// -------------------------------------------------------------------------
	// /sanction kick
	// -------------------------------------------------------------------------

	@Slash({ name: "kick", description: "Expulser un utilisateur du serveur" })
	@Guard(CASLGuard("moderate", "Sanction"))
	async kick(
		@SlashOption({
			name: "user",
			description: "Utilisateur à expulser",
			type: ApplicationCommandOptionType.User,
			required: true,
		})
		rawUser: DiscordUser | GuildMember,
		@SlashOption({
			name: "reason",
			description: "Raison",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		reason: string,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply();

		const target = resolveDiscordUser(rawUser);

		if (isDev(target.id)) {
			return followUpWithErrorEmbed(interaction, "Impossible de sanctionner un développeur.");
		}

		if (target.id === interaction.user.id) {
			return followUpWithErrorEmbed(interaction, "Vous ne pouvez pas vous sanctionner vous-même.");
		}

		if (target.bot) {
			return followUpWithErrorEmbed(interaction, "Impossible de kick un bot.");
		}

		const guildId = interaction.guildId!;

		let sanction;
		try {
			sanction = await this.sanctionService.issue({
				type: SanctionType.Kick,
				userId: target.id,
				guildId,
				reason,
				issuedBy: interaction.user.id,
			});
		} catch (err) {
			console.error("[SanctionCommands/kick]", err);
			return followUpWithErrorEmbed(interaction, "Erreur lors de l'émission de la sanction.");
		}

		try {
			await this.sanctionService.applyDiscordEffect(sanction);
		} catch (err) {
			if (err instanceof DiscordAPIError) {
				return followUpWithErrorEmbed(
					interaction,
					`Sanction enregistrée (\`${sanction.id}\`) mais expulsion échouée : ${err.message}`
				);
			}
			console.error("[SanctionCommands] effet Discord inattendu:", err);
			return followUpWithErrorEmbed(
				interaction,
				`Sanction enregistrée (\`${sanction.id}\`) mais une erreur inattendue est survenue lors de l'effet Discord.`
			);
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Red)
			.setTitle("👢 Utilisateur expulsé")
			.addFields(
				{
					name: "Utilisateur",
					value: `${userMention(target.id)} (${escapeMarkdown(target.username)})`,
					inline: true,
				},
				{ name: "Raison", value: reason, inline: false },
				{ name: "ID sanction", value: `\`${sanction.id}\``, inline: true }
			)
			.setTimestamp();

		await interaction.followUp({ embeds: [embed] });
	}

	// -------------------------------------------------------------------------
	// /sanction ban
	// -------------------------------------------------------------------------

	@Slash({ name: "ban", description: "Bannir un utilisateur du serveur" })
	@Guard(CASLGuard("moderate", "Sanction"))
	async ban(
		@SlashOption({
			name: "user",
			description: "Utilisateur à bannir",
			type: ApplicationCommandOptionType.User,
			required: true,
		})
		rawUser: DiscordUser | GuildMember,
		@SlashOption({
			name: "reason",
			description: "Raison",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		reason: string,
		@SlashOption({
			name: "duration",
			description: "Durée (ex: 7d, 30d) — permanent si absent",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		durationRaw: string | undefined,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply();

		const target = resolveDiscordUser(rawUser);

		if (isDev(target.id)) {
			return followUpWithErrorEmbed(interaction, "Impossible de sanctionner un développeur.");
		}

		if (target.id === interaction.user.id) {
			return followUpWithErrorEmbed(interaction, "Vous ne pouvez pas vous sanctionner vous-même.");
		}

		if (target.bot) {
			return followUpWithErrorEmbed(interaction, "Impossible de bannir un bot.");
		}

		let durationSec: number | null = null;
		if (durationRaw) {
			durationSec = parseDuration(durationRaw);
			if (!durationSec) {
				return followUpWithErrorEmbed(
					interaction,
					`Format de durée invalide : \`${durationRaw}\`. Exemples valides : \`7d\`, \`30d\`.`
				);
			}
		}

		const guildId = interaction.guildId!;

		let sanction;
		try {
			sanction = await this.sanctionService.issue({
				type: SanctionType.Ban,
				userId: target.id,
				guildId,
				reason,
				durationSec,
				issuedBy: interaction.user.id,
			});
		} catch (err) {
			console.error("[SanctionCommands/ban]", err);
			return followUpWithErrorEmbed(interaction, "Erreur lors de l'émission de la sanction.");
		}

		try {
			await this.sanctionService.applyDiscordEffect(sanction);
		} catch (err) {
			if (err instanceof DiscordAPIError) {
				return followUpWithErrorEmbed(
					interaction,
					`Sanction enregistrée (\`${sanction.id}\`) mais bannissement Discord échoué : ${err.message}`
				);
			}
			console.error("[SanctionCommands] effet Discord inattendu:", err);
			return followUpWithErrorEmbed(
				interaction,
				`Sanction enregistrée (\`${sanction.id}\`) mais une erreur inattendue est survenue lors de l'effet Discord.`
			);
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.DarkRed)
			.setTitle("🔨 Utilisateur banni")
			.addFields(
				{
					name: "Utilisateur",
					value: `${userMention(target.id)} (${escapeMarkdown(target.username)})`,
					inline: true,
				},
				{
					name: "Durée",
					value: durationSec ? formatDuration(durationSec) : "Permanent",
					inline: true,
				},
				{ name: "Raison", value: reason, inline: false },
				{ name: "ID sanction", value: `\`${sanction.id}\``, inline: true },
				{
					name: "Expire le",
					value: sanction.expiresAt
						? `<t:${Math.floor(sanction.expiresAt.getTime() / 1000)}:F>`
						: "Jamais",
					inline: true,
				}
			)
			.setTimestamp();

		await interaction.followUp({ embeds: [embed] });
	}

	// -------------------------------------------------------------------------
	// /sanction list
	// -------------------------------------------------------------------------

	@Slash({ name: "list", description: "Lister les sanctions actives d'un utilisateur" })
	@Guard(CASLGuard("moderate", "Sanction"))
	async list(
		@SlashOption({
			name: "user",
			description: "Utilisateur à consulter",
			type: ApplicationCommandOptionType.User,
			required: true,
		})
		rawUser: DiscordUser | GuildMember,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply();

		const target = resolveDiscordUser(rawUser);
		const guildId = interaction.guildId!;

		let sanctions;
		try {
			sanctions = await this.sanctionService.listActive(target.id, guildId);
		} catch (err) {
			console.error("[SanctionCommands/list]", err);
			return followUpWithErrorEmbed(interaction, "Erreur lors de la récupération des sanctions.");
		}

		if (sanctions.length === 0) {
			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setTitle(`${escapeMarkdown(target.username)} — Sanctions actives`)
				.setDescription("Aucune sanction active.")
				.setTimestamp();
			return interaction.followUp({ embeds: [embed] });
		}

		// Discord limite chaque champ d'embed à 1024 caractères → on borne à 20 sanctions
		// (colonnes alignées). Le surplus éventuel est signalé en pied d'embed.
		const MAX_LIST = 20;
		const shown = sanctions.slice(0, MAX_LIST);
		const typeCol = shown.map((s) => s.type).join("\n");
		const reasonCol = shown.map((s) => (s.reason ? s.reason.slice(0, 40) : "—")).join("\n");
		const durCol = shown
			.map((s) => (s.durationSec ? formatDuration(s.durationSec) : "—"))
			.join("\n");
		const expiresCol = shown
			.map((s) => (s.expiresAt ? `<t:${Math.floor(s.expiresAt.getTime() / 1000)}:R>` : "—"))
			.join("\n");
		const idCol = shown.map((s) => `\`${s.id.slice(0, 8)}…\``).join("\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle(`${escapeMarkdown(target.username)} — Sanctions actives (${sanctions.length})`)
			.setDescription(`${userMention(target.id)}`)
			.addFields(
				{ name: "Type", value: typeCol, inline: true },
				{ name: "Raison", value: reasonCol, inline: true },
				{ name: "Durée", value: durCol, inline: true },
				{ name: "Expire", value: expiresCol, inline: true },
				{ name: "ID (tronqué)", value: idCol, inline: true }
			)
			.setTimestamp();

		if (sanctions.length > MAX_LIST) {
			embed.setFooter({
				text: `… et ${sanctions.length - MAX_LIST} autre(s) sanction(s) non affichée(s).`,
			});
		}

		await interaction.followUp({ embeds: [embed] });
	}

	// -------------------------------------------------------------------------
	// /sanction revoke
	// -------------------------------------------------------------------------

	@Slash({ name: "revoke", description: "Révoquer une sanction par son ID" })
	@Guard(CASLGuard("manage", "Sanction"))
	async revoke(
		@SlashOption({
			name: "id",
			description: "UUID de la sanction à révoquer",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		sanctionId: string,
		@SlashOption({
			name: "reason",
			description: "Raison de la révocation",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		reason: string,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply();

		let sanction;
		try {
			sanction = await this.sanctionService.revoke(sanctionId, interaction.user.id, reason);
		} catch (err) {
			if (err instanceof Error && err.message.includes("not found")) {
				return followUpWithErrorEmbed(interaction, `Sanction \`${sanctionId}\` introuvable.`);
			}
			if (err instanceof DiscordAPIError) {
				return followUpWithErrorEmbed(
					interaction,
					`Sanction révoquée en base mais effet Discord échoué : ${err.message}`
				);
			}
			console.error("[SanctionCommands/revoke]", err);
			return followUpWithErrorEmbed(interaction, "Erreur lors de la révocation de la sanction.");
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Green)
			.setTitle("✅ Sanction révoquée")
			.addFields(
				{ name: "ID sanction", value: `\`${sanction.id}\``, inline: true },
				{ name: "Type", value: sanction.type, inline: true },
				{ name: "Utilisateur", value: userMention(sanction.userId), inline: true },
				{ name: "Raison de révocation", value: reason, inline: false }
			)
			.setTimestamp();

		await interaction.followUp({ embeds: [embed] });
	}
}
