import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	MessageFlags,
	PermissionFlagsBits,
	type Channel,
	type CommandInteraction,
	type GuildMember,
	type Role,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { AdminOnly } from "~/guards/AdminOnly";
import { SettingsService } from "~/services/SettingsService";
import { TikTokService } from "~/services/TikTokService";
import { brandedEmbed, errorEmbed, successEmbed } from "~/lib/embeds";

/**
 * Configuration de la surveillance TikTok (notif live + nouvelles vidéos).
 *
 * Le polling tourne dans `TikTokService` (cron `tiktok-watch`, 2 min). Cette
 * commande pilote l'activation, le salon cible, le rôle opt-in pingé, le pseudo
 * surveillé, et permet un test manuel. Réservée aux admins.
 */
@Discord()
@Bot("shenron")
@Guard(GuildOnly, AdminOnly)
@SlashGroup({
	name: "tiktok",
	description: "TikTok: notifications de live et de nouvelles vidéos",
	defaultMemberPermissions: PermissionFlagsBits.Administrator,
})
@SlashGroup("tiktok")
@injectable()
export class TikTokCommands {
	constructor(
		@inject(SettingsService) private settings: SettingsService,
		@inject(TikTokService) private tiktok: TikTokService
	) {}

	@Slash({
		name: "setup",
		description: "Configurer salon, rôle et pseudo, et activer la surveillance",
	})
	async setup(
		@SlashOption({
			name: "salon",
			description: "Salon où poster les notifications TikTok",
			type: ApplicationCommandOptionType.Channel,
			required: true,
		})
		channel: Channel,
		@SlashOption({
			name: "role",
			description: "Rôle opt-in à pinger (ex: notif tiktok)",
			type: ApplicationCommandOptionType.Role,
			required: false,
		})
		role: Role | undefined,
		@SlashOption({
			name: "pseudo",
			description: "Pseudo TikTok à surveiller (sans @, défaut: goku_dbfr)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		pseudo: string | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			await this.settings.set("tiktok.channel", channel.id);
			if (role) await this.settings.set("tiktok.role", role.id);
			if (pseudo) await this.settings.set("tiktok.username", pseudo.trim().replace(/^@/, ""));
			await this.settings.set("tiktok.enabled", "true");

			const username = await this.settings.getString("tiktok.username", "goku_dbfr");
			await interaction.editReply({
				embeds: [
					successEmbed(
						"Surveillance TikTok activée",
						[
							`Compte : **@${username}**`,
							`Salon : <#${channel.id}>`,
							role
								? `Ping : <@&${role.id}>`
								: "Ping : _aucun rôle_ (utilise `/tiktok setup` avec un rôle)",
							"",
							"Les membres s'abonnent avec `/notif-tiktok`. Vérif immédiate avec `/tiktok test`.",
						].join("\n")
					),
				],
			});
		} catch (err) {
			await interaction.editReply({
				embeds: [errorEmbed("Erreur", err instanceof Error ? err.message : "Erreur inconnue")],
			});
		}
	}

	@Slash({ name: "disable", description: "Désactiver la surveillance TikTok" })
	async disable(interaction: CommandInteraction) {
		await this.settings.set("tiktok.enabled", "false");
		await interaction.reply({
			embeds: [successEmbed("Surveillance TikTok désactivée", "Le polling ne postera plus rien.")],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({
		name: "videos",
		description: "Activer/désactiver les notifs de nouvelles vidéos (le live reste actif)",
	})
	async videos(
		@SlashOption({
			name: "actif",
			description: "true = notifier les vidéos, false = live uniquement",
			type: ApplicationCommandOptionType.Boolean,
			required: true,
		})
		actif: boolean,
		interaction: CommandInteraction
	) {
		await this.settings.set("tiktok.videos", actif ? "true" : "false");
		await interaction.reply({
			embeds: [
				successEmbed(
					"Notifs vidéos " + (actif ? "activées" : "désactivées"),
					actif
						? "Best-effort : dépend du SSR TikTok. Si rien ne remonte, configure un proxy via `/tiktok proxy`."
						: "Seuls les lives seront annoncés."
				),
			],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({ name: "proxy", description: "Définir un proxy HTTP(S) pour TikTok (vide = direct)" })
	async proxy(
		@SlashOption({
			name: "url",
			description: "URL du proxy (ex: http://user:pass@host:port). Laisser vide pour retirer.",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		url: string | undefined,
		interaction: CommandInteraction
	) {
		await this.settings.set("tiktok.proxy", (url ?? "").trim());
		await interaction.reply({
			embeds: [
				successEmbed(
					"Proxy TikTok " + (url?.trim() ? "défini" : "retiré"),
					url?.trim()
						? "Les requêtes TikTok passeront par ce proxy."
						: "Requêtes en direct depuis le VPS."
				),
			],
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({ name: "test", description: "Vérifier maintenant (poste si live/vidéo détecté)" })
	async test(interaction: CommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const r = await this.tiktok.runOnce();
		if (!r.ok) {
			const reason =
				r.reason === "fetch_failed"
					? `Impossible de lire le profil **@${r.username ?? "?"}** (blocage TikTok / IP filtrée ? essaie \`/tiktok proxy\`)`
					: r.reason === "disabled"
						? "Surveillance désactivée (`/tiktok setup`)."
						: "Erreur lors de la vérification (voir logs).";
			await interaction.editReply({ embeds: [errorEmbed("Échec du test", reason)] });
			return;
		}
		await interaction.editReply({
			embeds: [
				brandedEmbed({
					title: "Test TikTok",
					description: [
						`Compte : **@${r.username}**`,
						`Live : ${r.live ? "🔴 EN LIVE" : "hors-ligne"}${r.announcedLive ? " (notif envoyée)" : ""}`,
						`Vidéos vues (SSR) : ${r.videosSeen ?? 0}${r.announcedVideos ? ` — ${r.announcedVideos} annoncée(s)` : ""}`,
					].join("\n"),
					kind: "info",
				}),
			],
		});
	}

	@Slash({ name: "status", description: "État de la surveillance TikTok" })
	async status(interaction: CommandInteraction) {
		const enabled = await this.settings.getBool("tiktok.enabled", false);
		const username = await this.settings.getString("tiktok.username", "goku_dbfr");
		const channelId = await this.settings.getSnowflake("tiktok.channel");
		const roleId = await this.settings.getSnowflake("tiktok.role");
		const videos = await this.settings.getBool("tiktok.videos", true);
		const proxy = (await this.settings.getString("tiktok.proxy", "")).trim();
		const liveActive = await this.settings.getBool("tiktok.live_active", false);
		await interaction.reply({
			embeds: [
				brandedEmbed({
					title: "Statut TikTok",
					description: [
						`Surveillance : ${enabled ? "✅ active" : "⛔ inactive"}`,
						`Compte : **@${username}**`,
						`Salon : ${channelId ? `<#${channelId}>` : "_non configuré_"}`,
						`Ping rôle : ${roleId ? `<@&${roleId}>` : "_aucun_"}`,
						`Notifs vidéos : ${videos ? "oui (best-effort)" : "non"}`,
						`Proxy : ${proxy ? "configuré" : "direct"}`,
						`Live en cours : ${liveActive ? "🔴 oui" : "non"}`,
					].join("\n"),
					kind: "info",
				}),
			],
			flags: MessageFlags.Ephemeral,
		});
	}
}

/**
 * Commande publique : opt-in/opt-out du rôle de notification TikTok.
 *
 * Toggle le rôle configuré (`tiktok.role`) sur l'appelant. Permet à chaque
 * membre de choisir de recevoir (ou non) les pings de live/vidéo.
 */
@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@injectable()
export class TikTokNotifCommand {
	constructor(@inject(SettingsService) private settings: SettingsService) {}

	@Slash({
		name: "notif-tiktok",
		description: "S'abonner / se désabonner des notifications TikTok",
	})
	async notif(interaction: CommandInteraction) {
		const roleId = await this.settings.getSnowflake("tiktok.role");
		if (!roleId) {
			await interaction.reply({
				embeds: [
					errorEmbed(
						"Indisponible",
						"Aucun rôle de notification TikTok n'est configuré. Un admin doit lancer `/tiktok setup`."
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const member = interaction.member as GuildMember | null;
		if (!member || !("roles" in member)) {
			await interaction.reply({
				embeds: [errorEmbed("Erreur", "Impossible de récupérer ton profil membre.")],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		try {
			if (member.roles.cache.has(roleId)) {
				await member.roles.remove(roleId, "opt-out notif tiktok");
				await interaction.reply({
					embeds: [successEmbed("Désabonné", "Tu ne recevras plus les notifications TikTok.")],
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await member.roles.add(roleId, "opt-in notif tiktok");
				await interaction.reply({
					embeds: [
						successEmbed(
							"Abonné",
							`Tu seras pingé (<@&${roleId}>) à chaque live et nouvelle vidéo TikTok !`
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch {
			await interaction.reply({
				embeds: [
					errorEmbed(
						"Échec",
						"Je n'ai pas pu modifier ton rôle. Vérifie que mon rôle est au-dessus du rôle de notif dans la hiérarchie."
					),
				],
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
