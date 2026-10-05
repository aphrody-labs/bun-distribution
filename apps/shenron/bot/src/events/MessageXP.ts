import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { eq, sql } from "drizzle-orm";
import { LevelService } from "~/services/LevelService";
import { EconomyService } from "~/services/EconomyService";
import { AchievementService } from "~/services/AchievementService";
import { DatabaseService } from "~/db/index";
import { actionLogs, users } from "~/db/schema";
import {
	DISCORD_INVITE_REGEX,
	XP_MESSAGE_COOLDOWN_MS,
	XP_PER_MESSAGE_MAX,
	XP_PER_MESSAGE_MIN,
	ZENI_DAILY_QUEST,
} from "~/lib/constants";
import { env } from "~/lib/env";
import { randomInt } from "~/lib/xp";
import { applyZeniRace, hasRegen, regenTuning } from "~/lib/races";
import { resolveLevelChannel } from "~/lib/announce";
import { boosterXpMultiplier } from "~/lib/booster";
import { bestRoleMultiplier, loadXpBoostConfig, messageBoost } from "~/lib/xp-boosts";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { ModerationService } from "~/services/ModerationService";
import { SettingsService } from "~/services/SettingsService";
import { logger } from "~/lib/logger";

@Discord()
@Bot("shenron")
@injectable()
export class MessageXPEvent {
	constructor(
		@inject(LevelService) private levels: LevelService,
		@inject(EconomyService) private eco: EconomyService,
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(ModerationService) private mod: ModerationService,
		@inject(AchievementService) private achievements: AchievementService,
		@inject(MessageTemplateService) private msg: MessageTemplateService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	@On({ event: "messageCreate" })
	async onMessage([message]: ArgsOf<"messageCreate">) {
		if (!message.inGuild() || message.author.bot) return;
		const userId = message.author.id;

		// Anti-lien Discord externe — configurable via anti_invite.* (enabled / action / whitelist_url).
		const match = message.content.match(DISCORD_INVITE_REGEX);
		if (match && (await this.settings.getBool("anti_invite.enabled", true))) {
			const url = match[0].toLowerCase();
			const ownTail =
				env.SERVER_INVITE_URL?.replace(/^https?:\/\//, "")
					.toLowerCase()
					.split("/")
					.pop() ?? "";
			// Whitelist additionnelle. Le placeholder "discord.gg/" (défaut historique)
			// matcherait toutes les invites → on ne l'applique que s'il porte un
			// segment de chemin spécifique (ex: discord.gg/dragonball).
			const wl = (await this.settings.getString("anti_invite.whitelist_url", ""))
				.trim()
				.toLowerCase()
				.replace(/^https?:\/\//, "");
			const wlSpecific = wl !== "" && wl !== "discord.gg/" && /\/[^/]+/.test(wl);
			const isOwn = (ownTail !== "" && url.includes(ownTail)) || (wlSpecific && url.includes(wl));
			if (!isOwn && message.member && !message.member.permissions.has("ModerateMembers")) {
				await message.delete().catch(() => {});
				const action = (await this.settings.getString("anti_invite.action", "jail")).toLowerCase();
				try {
					if (action === "warn") {
						await this.mod.addWarn(userId, message.client.user!.id, "Lien Discord externe détecté");
					} else if (action === "delete") {
						// message déjà supprimé — aucune sanction supplémentaire
					} else {
						// "jail" (défaut, comportement historique) — couvre aussi toute valeur inconnue
						await this.mod.jail(
							message.member,
							message.client.user!.id,
							"Lien Discord externe détecté",
							24 * 3600_000
						);
						await this.msg.publish(
							"anti_link_jail",
							{ user: `<@${userId}>`, url: match[0] },
							message.client
						);
					}
				} catch (err) {
					logger.warn({ err, action }, "anti-link action failed");
				}
				return;
			}
		}

		// XP + quête quotidienne
		await this.levels.ensureUser(userId);
		const user = await this.levels.getUser(userId);
		if (!user) return;
		const now = Date.now();
		const last = user.lastMessageAt?.getTime() ?? 0;

		const announce =
			(await resolveLevelChannel(message.client, message.guild ?? undefined)) ??
			("send" in message.channel ? message.channel : null);
		if (!announce) return;

		// Quête quotidienne — message rendu par le template `daily_quest`.
		const today = new Date(now).setHours(0, 0, 0, 0);
		const lastQuest = user.lastDailyQuestAt?.getTime() ?? 0;
		const isNewDay = lastQuest < today;
		if (isNewDay) {
			const yesterday = new Date(now);
			yesterday.setDate(yesterday.getDate() - 1);
			const yesterdayDelta = today - yesterday.setHours(0, 0, 0, 0);
			const streak = lastQuest >= today - yesterdayDelta ? user.dailyStreak + 1 : 1;
			const dailyZeni = applyZeniRace(
				user.race,
				await this.settings.getInt("zeni.daily_quest", ZENI_DAILY_QUEST)
			);
			await this.dbs.db
				.update(users)
				.set({ lastDailyQuestAt: new Date(now), dailyStreak: streak })
				.where(eq(users.id, userId));
			// Via `addZeni` : incrément atomique (l'ancien `user.zeni + n`, calculé
			// sur une lecture antérieure, écrasait les gains concurrents), gel et
			// anti-triche respectés. La race est déjà appliquée ci-dessus.
			await this.eco.addZeni(userId, dailyZeni, { source: "daily", applyRace: false });
			await this.dbs.db.insert(actionLogs).values({
				userId,
				action: "ZENI_DAILY",
				meta: JSON.stringify({ amount: dailyZeni }),
			});
			await this.msg.publish(
				"daily_quest",
				{ user: `<@${userId}>`, zeni: dailyZeni, streak },
				message.client
			);
		}

		// Succès — résolution lazy via le template service (gère canal + texte).
		const isFirstMessage = user.messageCount === 0;
		const granted = await this.achievements.checkMessage(userId, message.content);
		if (isFirstMessage) {
			await this.eco.grantAchievement(userId, "FIRST_MESSAGE");
			await this.msg.publish(
				"first_message",
				{ user: `<@${userId}>`, userName: message.author.username },
				message.client
			);
		}
		for (const code of granted) {
			await this.msg.publish(
				"achievement_unlocked",
				{ user: `<@${userId}>`, userName: message.author.username, code },
				message.client
			);
		}
		await this.dbs.db
			.update(users)
			.set({ messageCount: user.messageCount + 1 })
			.where(eq(users.id, userId));

		// Toggle features.message_xp — fallback true (DB vide = activé par défaut, jamais couper l'XP par accident).
		if (!(await this.settings.getBool("features.message_xp", true))) return;

		// XP cooldown — settings runtime avec fallback constants
		const cooldownMs = await this.settings.getInt("xp.message.cooldown_ms", XP_MESSAGE_COOLDOWN_MS);
		if (now - last < cooldownMs) return;
		const xpMin = await this.settings.getInt("xp.message.min", XP_PER_MESSAGE_MIN);
		const xpMax = await this.settings.getInt("xp.message.max", XP_PER_MESSAGE_MAX);
		let gain = randomInt(xpMin, xpMax);

		// Régén passive Namek : 1×/24 h, à la 1re activité du jour (+XP & +zéni).
		const regen = regenTuning();
		if (hasRegen(user.race) && now - (user.lastRaceRegenAt?.getTime() ?? 0) >= regen.ms) {
			await this.dbs.db
				.update(users)
				.set({ lastRaceRegenAt: new Date(now) })
				.where(eq(users.id, userId));
			await this.eco.addZeni(userId, regen.zeni, { source: "regen", applyRace: false });
			await this.dbs.db.insert(actionLogs).values({
				userId,
				action: "ZENI_REGEN",
				meta: JSON.stringify({ amount: regen.zeni }),
			});
			gain += regen.xp;
		}

		// Drop zeni aléatoire (zeni.message_chance probabilité) + notif templatable
		const dropChance = await this.settings.getFloat("zeni.message_chance", 0);
		if (dropChance > 0 && Math.random() < dropChance) {
			const dropMin = await this.settings.getInt("zeni.message_drop_min", 5);
			const dropMax = await this.settings.getInt("zeni.message_drop_max", 25);
			const drop = applyZeniRace(user.race, randomInt(dropMin, dropMax));
			if (drop > 0) {
				await this.eco.addZeni(userId, drop, { source: "drop", applyRace: false });
				await this.dbs.db.insert(actionLogs).values({
					userId,
					action: "ZENI_DROP",
					meta: JSON.stringify({ amount: drop }),
				});
				await this.msg.publish("zeni_drop", { user: `<@${userId}>`, zeni: drop }, message.client);
			}
		}

		// Multiplicateurs : meilleur rôle boosté ou boost booster (ne se cumulent
		// pas), race et Zenkai, boost de nuit, sous le plafond `xp.multiplier.max`.
		const member = message.member;
		const roleMultiplier = member
			? bestRoleMultiplier(
					(roleId) => member.roles.cache.has(roleId),
					await this.settings.getXpBoostRoles(),
					await boosterXpMultiplier(member, this.settings)
				)
			: 1;
		const boost = messageBoost(
			{ roleMultiplier, race: user.race, raceBoostUntil: user.raceBoostUntil?.getTime() ?? 0, now },
			await loadXpBoostConfig(this.settings)
		);
		gain = Math.floor(gain * boost.total);

		await this.dbs.db
			.update(users)
			.set({ lastMessageAt: new Date(now) })
			.where(eq(users.id, userId));
		const res = await this.levels.addXP(userId, gain, { propagateFusion: true, source: "message" });
		if (res.levelUp) {
			// Fallback : si message.member est null (intent GuildMembers pas encore
			// hydraté, cache miss), fetch côté Discord avant de poser le rôle.
			const member =
				message.member ??
				(message.guild ? await message.guild.members.fetch(userId).catch(() => null) : null);
			if (member) {
				await this.levels.handleLevelUp(member, res.newLevel, announce);
			} else {
				logger.warn(
					{ userId, newLevel: res.newLevel },
					"levelUp détecté mais GuildMember introuvable — rôle level non posé"
				);
			}
		}
	}
}
