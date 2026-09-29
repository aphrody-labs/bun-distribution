import { discordEmbedAvatar } from "@shenron/config/public-urls";
import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashOption } from "discordx";
import { userTransformer } from "~/lib/slash-user";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	type APIEmbed,
	type CommandInteraction,
	type User,
} from "discord.js";
import { Pagination, PaginationResolver } from "@discordx/pagination";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { LevelService } from "~/services/LevelService";
import { EconomyService } from "~/services/EconomyService";
import { CardService } from "~/services/CardService";
import { LeaderboardService, type LeaderboardEntry } from "~/services/LeaderboardService";
import { logger } from "~/lib/logger";
import { levelForXP, xpRequiredForLevel, nextThresholdFrom, formatXP } from "~/lib/xp";
import { SHENRON_THEME, SHENRON_SEPARATORS, renderProgressBar } from "~/lib/embeds";
import { SettingsService } from "~/services/SettingsService";
import { boosterXpMultiplier } from "~/lib/booster";
import { env } from "~/lib/env";
import {
	XP_MESSAGE_COOLDOWN_MS,
	XP_PER_MESSAGE_MAX,
	XP_PER_MESSAGE_MIN,
	XP_PER_VOICE_TICK,
} from "~/lib/constants";
import {
	bestRoleMultiplier,
	formatMultiplier,
	isNight,
	loadXpBoostConfig,
	messageBoost,
	statusRatio,
	voiceBoost,
	voiceChannelContext,
	voicePresencesByChannel,
	type XpBoost,
} from "~/lib/xp-boosts";

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@injectable()
export class LevelCommands {
	constructor(
		@inject(LevelService) private levels: LevelService,
		@inject(EconomyService) private eco: EconomyService,
		@inject(CardService) private cards: CardService,
		@inject(LeaderboardService) private leaderboard: LeaderboardService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	/**
	 * Détail des multiplicateurs d'XP du membre à cet instant. Répond aux
	 * « pourquoi je ne monte pas ? » : chaque facteur est nommé, et une absence
	 * de gain en vocal est expliquée.
	 */
	@Slash({
		name: "boosts",
		description: "Tes multiplicateurs d'XP actifs : rôle, race, nuit, vocal à plusieurs, sleepcall",
	})
	async boosts(interaction: CommandInteraction) {
		if (!interaction.inCachedGuild()) return;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const now = Date.now();
		const cfg = await loadXpBoostConfig(this.settings);
		const member = interaction.member;
		const user = await this.levels.getUser(interaction.user.id);
		const roleMultiplier = member?.roles
			? bestRoleMultiplier(
					(roleId) => member.roles.cache.has(roleId),
					await this.settings.getXpBoostRoles(),
					await boosterXpMultiplier(member, this.settings)
				)
			: 1;
		const base = {
			roleMultiplier,
			race: user?.race,
			raceBoostUntil: user?.raceBoostUntil?.getTime() ?? 0,
			now,
		};
		const xpMin = await this.settings.getInt("xp.message.min", XP_PER_MESSAGE_MIN);
		const xpMax = await this.settings.getInt("xp.message.max", XP_PER_MESSAGE_MAX);
		const cooldownMs = await this.settings.getInt("xp.message.cooldown_ms", XP_MESSAGE_COOLDOWN_MS);
		const perMinute = (await this.settings.getInt("xp.voice.per_minute", 0)) || XP_PER_VOICE_TICK;

		const detail = (boost: XpBoost) =>
			boost.parts.length === 0
				? "aucun bonus"
				: boost.parts.map((p) => `${p.label} ${formatMultiplier(p.value)}`).join(" · ") +
					(boost.capped ? ` · plafonné à ${formatMultiplier(cfg.maxMultiplier)}` : "");
		const percent = (n: number) => Math.round(n * 100);

		const message = messageBoost(base, cfg);
		const lines = [
			`**Écrit** : ${formatXP(xpMin)} à ${formatXP(xpMax)} XP par message, un gain toutes les ${Math.round(cooldownMs / 1000)} s`,
			`> ${formatMultiplier(message.total)} — ${detail(message)}`,
			"",
			`**Vocal** : ${formatXP(perMinute)} XP par minute avant bonus`,
		];

		const channelId = member?.voice?.channelId;
		if (!channelId) {
			lines.push("> Tu n'es pas en vocal.");
		} else {
			const hubId =
				(await this.settings.getRaw("channel.vocal_tempo_hub")) ?? env.VOCAL_TEMPO_HUB_ID;
			const presences = voicePresencesByChannel(interaction.guild, hubId).get(channelId) ?? [];
			const ctx = voiceChannelContext(presences, cfg, now);
			const me = ctx.earners.find((p) => p.userId === interaction.user.id);
			if (me) {
				const voice = voiceBoost({ ...base, status: me.status, channel: ctx }, cfg);
				lines.push(
					`> Dans <#${channelId}>${ctx.sleepcall ? " en **sleepcall**" : ""} : ${formatMultiplier(voice.total)}, soit **${formatXP(Math.floor(perMinute * voice.total))} XP/min** — ${detail(voice)}`
				);
			} else {
				const present = presences.find((p) => p.userId === interaction.user.id);
				const reason = !present
					? "salon exclu ou micro coupé par un modérateur"
					: statusRatio(present.status, cfg) === 0
						? "micro ou casque coupé ne rapporte rien en ce moment"
						: `il faut au moins ${cfg.voice.minMembers} membres qui gagnent dans le salon`;
				lines.push(`> Dans <#${channelId}> : aucun gain pour l'instant (${reason}).`);
			}
		}

		const nightWindow = `${cfg.night.startHour} h à ${cfg.night.endHour} h`;
		lines.push(
			"",
			"**Bonus du serveur**",
			cfg.night.enabled
				? `• Nuit, de ${nightWindow} : écrit ${formatMultiplier(cfg.night.messageMultiplier)}, vocal ${formatMultiplier(cfg.night.voiceMultiplier)}${isNight(now, cfg) ? " — **en cours**" : ""}`
				: "• Boost de nuit désactivé",
			cfg.sleepcall.enabled && cfg.night.enabled
				? `• Sleepcall : la nuit, dès ${cfg.sleepcall.minMembers} en vocal, ${formatMultiplier(cfg.sleepcall.multiplier)} pour tous, micro et casque coupés compris`
				: "• Sleepcall désactivé",
			`• Vocal à plusieurs : +${percent(cfg.group.bonusPerMember)} % par membre en plus, jusqu'à ${formatMultiplier(cfg.group.maxMultiplier)}`,
			`• Micro coupé : ${percent(cfg.voice.mutedRatio)} % du gain · casque coupé : ${percent(cfg.voice.deafenedRatio)} %`
		);

		const embed = new EmbedBuilder()
			.setColor(SHENRON_THEME.gold)
			.setTitle("⚡ Multiplicateurs d'XP")
			.setDescription(lines.join("\n"))
			.setFooter({
				text: `Rôle et booster ne se cumulent pas · plafond cumulé ${formatMultiplier(cfg.maxMultiplier)} · ${cfg.night.timezone}`,
			});
		await interaction.editReply({ embeds: [embed] });
	}

	@Slash({ name: "profil", description: "Voir le profil d'un membre (carte image et statistiques détaillées)" })
	async profil(
		@SlashOption(
			{
				name: "membre",
				description: "Membre (défaut: vous)",
				type: ApplicationCommandOptionType.User,
				required: false,
			},
			userTransformer
		)
		target: User | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();
		try {
			const user = target ?? interaction.user;
			const data = await this.levels.getUser(user.id);
			const fusion = await this.eco.getFusion(user.id);
			const rank = await this.levels.rankOf(user.id);

			const xp = data?.xp ?? 0;
			const zeni = data?.zeni ?? 0;
			const messageCount = data?.messageCount ?? 0;

			const currentLevel = levelForXP(xp);
			const currentBaseXp = xpRequiredForLevel(currentLevel);
			const nextThresh = nextThresholdFrom(xp);
			const nextXp = nextThresh ? nextThresh.xp : xp;
			const progressInLevel = Math.max(0, xp - currentBaseXp);
			const neededForNext = Math.max(1, nextXp - currentBaseXp);

			const pbar = nextThresh
				? renderProgressBar(progressInLevel, neededForNext, 12)
				: "▰▰▰▰▰▰▰▰▰▰▰▰ MAX";

			const partnerId = fusion?.userA === user.id ? fusion.userB : fusion?.userA;

			// Résolution exhaustive des parures équipées (titre, badge, couleur, bannière)
			const [titleItem, badgeItem, colorItem, bannerItem] = await Promise.all([
				data?.equippedTitle ? this.eco.getShopItem(data.equippedTitle) : Promise.resolve(null),
				data?.equippedBadge ? this.eco.getShopItem(data.equippedBadge) : Promise.resolve(null),
				data?.equippedColor ? this.eco.getShopItem(data.equippedColor) : Promise.resolve(null),
				data?.equippedBanner ? this.eco.getShopItem(data.equippedBanner) : Promise.resolve(null),
			]);
			const titleText = titleItem?.name ?? data?.equippedTitle ?? null;
			const badgeText = badgeItem
				? (badgeItem.name.match(/[\u3400-\u9FFF]/)?.[0] ?? badgeItem.name)
				: (data?.equippedBadge ?? null);

			// Résolution de la couleur : priorité rôle Discord > meta.colorHex > hex direct > null (fallback thème)
			let colorHex: string | null = null;
			if (colorItem?.roleId && interaction.guild) {
				const role = interaction.guild.roles.cache.get(colorItem.roleId);
				if (role?.color) {
					colorHex = `#${role.color.toString(16).padStart(6, "0")}`;
				}
			}
			if (!colorHex && colorItem?.meta) {
				try {
					const parsed = JSON.parse(colorItem.meta);
					if (parsed.colorHex) colorHex = parsed.colorHex;
				} catch {}
			}
			if (!colorHex && data?.equippedColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(data.equippedColor.trim())) {
				colorHex = data.equippedColor.trim();
			}

			// Résolution du visuel de bannière équipé
			let bannerPath: string | null = null;
			if (bannerItem?.meta) {
				try {
					const parsed = JSON.parse(bannerItem.meta);
					if (parsed.bannerPath) bannerPath = parsed.bannerPath;
				} catch {}
			}

			const buffer = await this.cards.render({
				discordUser: user,
				xp,
				zeni,
				messageCount,
				cardKey: data?.equippedCard ?? null,
				bannerPath,
				bannerKey: data?.equippedBanner ?? null,
				badge: badgeText,
				title: titleText,
				color: colorHex,
				fused: !!fusion,
				rank,
			});
			const file = new AttachmentBuilder(buffer, { name: `profil-${user.id}.png` });

			const embed = new EmbedBuilder()
				.setColor(colorHex ? parseInt(colorHex.replace("#", ""), 16) : SHENRON_THEME.saiyanBlue)
				.setAuthor({
					name: `Carte de Combattant · ${user.displayName ?? user.username}`,
					iconURL: user.displayAvatarURL({ size: 128 }),
				})
				.setTitle(`⚡ ${titleText ? `« ${titleText} »` : "Combattant du Sanctuaire"}`)
				.setImage(`attachment://profil-${user.id}.png`)
				.setDescription(
					[
						`**Progression Martiale · Niveau ${currentLevel}**`,
						`> \`${pbar}\``,
						`> **${formatXP(xp)}** / **${nextThresh ? formatXP(nextXp) : "MAX"} XP** ${nextThresh ? `*(encore ${formatXP(nextXp - xp)} XP)*` : ""}`,
						"",
						`${SHENRON_SEPARATORS.solid}`,
					].join("\n")
				)
				.addFields(
					{
						name: "🏆 Rang Serveur",
						value: `**#${rank}**`,
						inline: true,
					},
					{
						name: "💰 Fortune",
						value: `**${formatXP(zeni)}** zénis`,
						inline: true,
					},
					{
						name: "💬 Activité",
						value: `**${formatXP(messageCount)}** messages`,
						inline: true,
					},
					{
						name: "🎒 Équipement Actif",
						value: [
							`• 🖼️ Carte : **${data?.equippedCard ?? "Classique"}**`,
							`• 🌌 Bannière : **${bannerItem?.name ?? data?.equippedBanner ?? "Défaut"}**`,
							`• 🎖️ Badge : **${badgeItem?.name ?? data?.equippedBadge ?? "Aucun"}**`,
							`• 🎨 Couleur : **${colorItem?.name ?? (data?.equippedColor ? "Équipée" : "Défaut")}**`,
						].join("\n"),
						inline: true,
					},
					{
						name: "💫 Union Sacrée (Fusion)",
						value: partnerId
							? `Fusionné(e) avec <@${partnerId}>\n*+10 % XP & Zénis partagés*`
							: "*Célibataire (aucune fusion)*",
						inline: true,
					}
				)
				.setFooter({
					text: "Shenron Profil System · dragonballfr.com",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTimestamp();

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("shop:open")
					.setLabel("Boutique")
					.setEmoji("🏪")
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId("shop:eprofil")
					.setLabel("Inventaire")
					.setEmoji("🎒")
					.setStyle(ButtonStyle.Secondary)
			);

			await interaction.editReply({ embeds: [embed], files: [file], components: [row] });
		} catch (err) {
			logger.error({ err }, "Échec de rendu /profil");
			await interaction.editReply({
				content: "⚠️ Une erreur temporaire est survenue lors de la génération de votre profil. Veuillez réessayer dans quelques instants.",
			});
		}
	}

	@Slash({ name: "top", description: "Classement des membres par XP et puissance" })
	async top(interaction: CommandInteraction) {
		if (!interaction.inCachedGuild()) return;
		await interaction.deferReply();

		const total = await this.levels.totalUsers();
		if (total === 0) {
			await interaction.editReply({ content: "Aucun membre enregistré." });
			return;
		}
		const pageSize = 10;
		const totalPages = Math.max(1, Math.ceil(total / pageSize));
		const guildName = interaction.guild.name;

		// Résout un user Discord → entry leaderboard (avatar + username)
		const toEntry = async (row: {
			id: string;
			xp: number;
			zeni: number;
		}): Promise<LeaderboardEntry> => {
			let username = `Saiyan #${row.id.slice(-4)}`;
			let avatarURL = discordEmbedAvatar(0);
			try {
				const user = await interaction.client.users.fetch(row.id);
				username = user.displayName ?? user.username;
				avatarURL = user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
			} catch {
				/* user left Discord ou fetch failed — garde les placeholders */
			}
			return { id: row.id, username, avatarURL, xp: row.xp, zeni: row.zeni };
		};

		const podiumMedals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

		// Rend un buffer PNG et l'embed pour la page demandée
		const renderPageData = async (i: number): Promise<{ file: AttachmentBuilder; embed: EmbedBuilder }> => {
			const rows = await this.levels.top(pageSize, i * pageSize);
			const entries = await Promise.all(rows.map(toEntry));
			const buffer = await this.leaderboard.render(entries, {
				title: "CLASSEMENT",
				subtitle: guildName,
				page: i + 1,
				totalPages,
			});
			const file = new AttachmentBuilder(buffer, { name: `top-p${i + 1}.png` });

			const lines = entries.map((e, idx) => {
				const pos = i * pageSize + idx + 1;
				const medal = podiumMedals[idx] ?? `**#${pos}**`;
				const lvl = levelForXP(e.xp);
				return `${medal} **${e.username}** · Niv. **${lvl}** (${formatXP(e.xp)} XP) — ${formatXP(e.zeni)} 𝓩`;
			});

			const embed = new EmbedBuilder()
				.setColor(SHENRON_THEME.gold)
				.setAuthor({
					name: `Panthéon des Guerriers · ${guildName}`,
					iconURL: interaction.guild.iconURL({ size: 128 }) ?? "https://dragonballfr.com/favicon.ico",
				})
				.setTitle("🏆 CLASSEMENT DE PUISSANCE SHENRON · 頂上決戦")
				.setDescription(
					[
						`*Les combattants les plus puissants du sanctuaire réunis.*`,
						"",
						`${SHENRON_SEPARATORS.solid}`,
						lines.join("\n"),
						`${SHENRON_SEPARATORS.solid}`,
					].join("\n")
				)
				.setImage(`attachment://top-p${i + 1}.png`)
				.setFooter({
					text: `Page ${i + 1}/${totalPages} · ${total} combattants répertoriés · dragonballfr.com`,
					iconURL: "https://dragonballfr.com/favicon.ico",
				});

			return { file, embed };
		};

		// 1 page → envoi direct, pas de pagination
		if (totalPages === 1) {
			const { file, embed } = await renderPageData(0);
			await interaction.editReply({ embeds: [embed], files: [file] });
			return;
		}

		// Cache LRU mémoire pour éviter les re-renders inutiles
		const cache = new Map<number, { file: AttachmentBuilder; embed: EmbedBuilder }>();
		const resolver = new PaginationResolver(async (page) => {
			let data = cache.get(page);
			if (!data) {
				data = await renderPageData(page);
				cache.set(page, data);
			}
			return {
				embeds: [data.embed.toJSON() as APIEmbed],
				files: [data.file],
			};
		}, totalPages);

		const pagination = new Pagination(interaction, resolver, {
			time: 120_000,
			buttons: {
				previous: { label: "Précédent" },
				next: { label: "Suivant" },
				exit: { label: "Fermer" },
			},
			selectMenu: { disabled: true },
		});
		await pagination.send();
	}
}

