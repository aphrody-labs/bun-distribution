import { container, singleton, inject } from "tsyringe";
import { and, desc, eq, sql, lte } from "drizzle-orm";
import type { Guild, GuildMember, TextBasedChannel } from "discord.js";
import { DatabaseService } from "~/db/index";
import { users, levelRewards, actionLogs, fusions } from "~/db/schema";
import { or } from "drizzle-orm";
import { LEVEL_THRESHOLDS, ZENI_PER_LEVEL, FUSION_XP_BONUS_RATIO } from "~/lib/constants";
import { levelForXP, formatXP } from "~/lib/xp";
import { applyZeniRace, hasZenkai } from "~/lib/races";
import { DEFAULT_XP_BOOST_CONFIG } from "~/lib/xp-boosts";
import {
	allRaceLevelRoleIds,
	DEFAULT_LEVEL_RACE,
	hasRaceLadder,
	memberRaceId,
	raceLevelRoleAt,
	raceLevelRoleIds,
} from "~/lib/race-levels";
import { levelUpMessage } from "~/lib/dbz-flavor";
import { levelUpEmbed } from "~/lib/embeds";
import { logger } from "~/lib/logger";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { SettingsService } from "~/services/SettingsService";
import { AntiCheatService } from "~/services/AntiCheatService";
import { EconomyService } from "~/services/EconomyService";

@singleton()
export class LevelService {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(MessageTemplateService) private templates: MessageTemplateService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	private get db() {
		return this.dbs.db;
	}

	async ensureUser(userId: string) {
		await this.db.insert(users).values({ id: userId }).onConflictDoNothing();
	}

	async getUser(userId: string) {
		await this.ensureUser(userId);
		return this.db.query.users.findFirst({ where: eq(users.id, userId) });
	}

	/**
	 * Cumule du temps passé en vocal (`total_voice_ms`) — alimente le classement
	 * « vocal » et les stats de profil. Personne ne l'écrivait : la colonne
	 * restait à 0 pour tout le monde et le classement vocal était plat.
	 */
	async addVoiceTime(userId: string, ms: number, sessionStartedAt?: Date) {
		if (ms <= 0) return;
		await this.ensureUser(userId);
		await this.db
			.update(users)
			.set({
				totalVoiceMs: sql`${users.totalVoiceMs} + ${ms}`,
				...(sessionStartedAt ? { lastVoiceJoinAt: sessionStartedAt } : {}),
			})
			.where(eq(users.id, userId));
	}

	async addXP(
		userId: string,
		amount: number,
		options: {
			propagateFusion?: boolean;
			/** Provenance du gain : `admin` échappe au contrôle de pic. */
			source?: "message" | "voice" | "game" | "fusion" | "admin" | "other";
		} = { propagateFusion: true }
	): Promise<{
		before: number;
		after: number;
		levelUp: boolean;
		newLevel: number;
		partnerBonus?: number;
	}> {
		// Incident du 2026-09-11 : un octroi de 8,5 × 10²⁴ XP (au-delà de ce
		// qu'un entier JavaScript représente exactement) est passé sans contrôle,
		// et sa part de fusion avec lui. Un montant doit être un nombre fini, et
		// le solde reste dans les entiers sûrs.
		if (!Number.isFinite(amount)) throw new Error("Montant d'XP invalide.");
		amount = Math.trunc(amount);
		await this.ensureUser(userId);
		const current = await this.getUser(userId);
		const before = current?.xp ?? 0;
		const after = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, before + amount));
		amount = after - before;
		const oldLevel = levelForXP(before);
		const newLevel = levelForXP(after);
		const levelUp = newLevel > oldLevel;

		await this.db
			.update(users)
			.set({
				xp: after,
				lastLevelReached: newLevel,
				updatedAt: new Date(),
			})
			.where(eq(users.id, userId));
		await this.db.insert(actionLogs).values({
			userId,
			action: "XP_GAIN",
			meta: JSON.stringify({ amount, before, after, source: options.source ?? "other" }),
		});

		// Pic d'XP hors admin : signalé (sans gel), pour relecture.
		if (amount > 0 && options.source !== "admin") {
			const threshold = await this.settings.getInt("anticheat.xp.max_single", 5_000_000);
			if (amount > threshold) {
				await container.resolve(AntiCheatService).flag(userId, {
					code: "XP_SPIKE",
					severity: amount > threshold * 10 ? "high" : "medium",
					reason: `Gain d'XP anormal : +${amount} XP (seuil ${threshold}) via ${options.source ?? "other"}`,
					meta: { amount, threshold, source: options.source ?? "other" },
				});
			}
		}

		if (levelUp) {
			const zeniBonus = applyZeniRace(
				current?.race,
				await this.settings.getInt("zeni.per_level", ZENI_PER_LEVEL)
			);
			// Zenkai (Saiyen) : ouvre une fenêtre de boost d'XP après le palier.
			const boost: Partial<typeof users.$inferInsert> = {};
			if (hasZenkai(current?.race)) {
				const minutes = await this.settings.getInt(
					"xp.zenkai.minutes",
					DEFAULT_XP_BOOST_CONFIG.zenkai.minutes
				);
				boost.raceBoostUntil = new Date(Date.now() + Math.max(0, minutes) * 60_000);
			}
			if (Object.keys(boost).length > 0) {
				await this.db.update(users).set(boost).where(eq(users.id, userId));
			}
			// Via `addZeni` : gel, anti-triche et incrément atomique. Race déjà appliquée.
			await container
				.resolve(EconomyService)
				.addZeni(userId, zeniBonus, { source: "level", applyRace: false });
		}

		// Bonus fusion: le/la partenaire reçoit un % sans propagation inverse
		let partnerBonus: number | undefined;
		if (options.propagateFusion && amount > 0) {
			const partner = await this.partnerOf(userId);
			if (partner) {
				const ratio = await this.settings.getFloat("xp.fusion.bonus_ratio", FUSION_XP_BONUS_RATIO);
				partnerBonus = Math.floor(amount * ratio);
				if (partnerBonus > 0) {
					await this.addXP(partner, partnerBonus, { propagateFusion: false, source: "fusion" });
				}
			}
		}

		return { before, after, levelUp, newLevel, partnerBonus };
	}

	async partnerOf(userId: string): Promise<string | null> {
		const f = await this.db.query.fusions.findFirst({
			where: or(eq(fusions.userA, userId), eq(fusions.userB, userId)),
		});
		if (!f) return null;
		return f.userA === userId ? f.userB : f.userA;
	}

	async setXP(
		userId: string,
		xp: number
	): Promise<{ oldLevel: number; newLevel: number; levelUp: boolean }> {
		await this.ensureUser(userId);
		const current = await this.getUser(userId);
		const oldLevel = current?.lastLevelReached ?? levelForXP(current?.xp ?? 0);
		const newLevel = levelForXP(xp);
		await this.db
			.update(users)
			.set({ xp, lastLevelReached: newLevel, updatedAt: new Date() })
			.where(eq(users.id, userId));
		return { oldLevel, newLevel, levelUp: newLevel > oldLevel };
	}

	/**
	 * Top par XP (cohérent partout : slash /top, API /api/public/leaderboard,
	 * dashboard /admin/leaderboards). Filtre xp > 0 pour éliminer les ~5800
	 * users à 0 XP qui sont créés lazy par ensureUser mais n'ont jamais
	 * envoyé de message. Sans ce filter le top affichait des doublons à 0.
	 */
	async top(limit = 10, offset = 0) {
		return this.db
			.select()
			.from(users)
			.where(sql`${users.xp} > 0`)
			.orderBy(desc(users.xp))
			.limit(limit)
			.offset(offset);
	}

	async rankOf(userId: string): Promise<number | null> {
		const u = await this.getUser(userId);
		if (!u || u.xp <= 0) return null;
		const [row] = await this.db
			.select({ c: sql<number>`count(*)` })
			.from(users)
			.where(sql`${users.xp} > ${u.xp}`);
		return Number(row?.c ?? 0) + 1;
	}

	async totalUsers(): Promise<number> {
		const [row] = await this.db
			.select({ c: sql<number>`count(*)` })
			.from(users)
			.where(sql`${users.xp} > 0`);
		return Number(row?.c ?? 0);
	}

	async listRewards() {
		return this.db.select().from(levelRewards).orderBy(levelRewards.level);
	}

	async handleLevelUp(member: GuildMember, newLevel: number, fallbackChannel?: TextBasedChannel) {
		// Le zéni de palier est RACE-AGNOSTIQUE (tout le monde le touche) ; les RÔLES
		// de palier dépendent de la RACE du membre (échelle dédiée, cf. race-levels.ts).
		const allRewards = await this.db
			.select()
			.from(levelRewards)
			.where(lte(levelRewards.level, newLevel))
			.orderBy(levelRewards.level);
		// On ne crédite le zeni bonus que pour le niveau actuel (les niveaux passés
		// sont supposés avoir été déjà crédités, ou on ne veut pas flood).
		const bonusZeni = allRewards
			.filter((r) => r.level === newLevel)
			.reduce((s, r) => s + r.zeniBonus, 0);

		// Rôles de transformation selon la race : on (re)pose ceux de la race du membre
		// jusqu'au niveau atteint (catch-up des paliers précédents inclus).
		const race = memberRaceId(member) ?? DEFAULT_LEVEL_RACE;
		const me = member.guild.members.me;
		for (const roleId of raceLevelRoleIds(race, newLevel)) {
			if (member.roles.cache.has(roleId)) continue;
			const role =
				member.guild.roles.cache.get(roleId) ??
				(await member.guild.roles.fetch(roleId).catch(() => null));
			if (!role) continue;
			if (me && role.position >= me.roles.highest.position) {
				logger.warn({ roleId, race }, "level reward role above bot — skipped");
				continue;
			}
			try {
				await member.roles.add(roleId, `Palier niveau ${newLevel} (${race})`);
			} catch (err) {
				logger.warn({ err, roleId }, "Failed to add level role");
			}
		}

		if (bonusZeni > 0) {
			await container
				.resolve(EconomyService)
				.addZeni(member.id, bonusZeni, { source: "level", applyRace: false });
		}

		await this.db.insert(actionLogs).values({
			userId: member.id,
			action: "LEVEL_UP",
			meta: JSON.stringify({
				level: newLevel,
				bonusZeni,
				race,
				rewards: [raceLevelRoleAt(race, newLevel)].filter(Boolean),
			}),
		});

		// Résolution canal via MessageTemplateService
		const target = await this.templates.resolveTarget("level_up", member.client);
		if (target && !target.enabled) return;
		const channel =
			target?.channel ?? (fallbackChannel && "send" in fallbackChannel ? fallbackChannel : null);
		if (!channel) return;

		const u = await this.getUser(member.id);
		const baseLevelZeni = await this.settings.getInt("zeni.per_level", ZENI_PER_LEVEL);
		const embed = levelUpEmbed({
			member,
			level: newLevel,
			xp: u?.xp ?? 0,
			zeniBonus: bonusZeni + baseLevelZeni,
			message: levelUpMessage(member.id, newLevel),
		});
		await channel.send({ content: `<@${member.id}>`, embeds: [embed] }).catch(() => {});
	}

	/**
	 * Réaligne les rôles de palier d'un membre sur sa RACE actuelle (dérivée de son
	 * rôle de race Discord) : retire les transformations des AUTRES races et (re)pose
	 * celles de sa race jusqu'à son niveau. Appelé au changement de race (commande
	 * `/race` ou rôle de race posé/retiré à la main — cf. events/JoinLeave.ts).
	 */
	async syncRaceLevelRoles(member: GuildMember): Promise<void> {
		const u = await this.getUser(member.id);
		const level = u?.lastLevelReached ?? levelForXP(u?.xp ?? 0);
		const race = memberRaceId(member) ?? DEFAULT_LEVEL_RACE;

		// GARDE : si la race du membre n'a AUCUNE échelle configurée (aucun palier),
		// on NE touche à rien — surtout on ne retire pas ses rôles de palier existants
		// (bug « removed everything » au passage à une race non configurée). L'admin
		// doit d'abord configurer les paliers de cette race (dashboard → race-rewards).
		if (!hasRaceLadder(race)) return;

		const keep = new Set(raceLevelRoleIds(race, level));

		// Retire les paliers qui n'appartiennent pas à la race courante (autres races).
		const toRemove = allRaceLevelRoleIds().filter(
			(rid) => !keep.has(rid) && member.roles.cache.has(rid)
		);
		if (toRemove.length) {
			await member.roles
				.remove(toRemove, "Changement de race — retrait des paliers d'une autre race")
				.catch((err) => logger.warn({ err, race }, "race level role removal failed"));
		}

		// (Re)pose les paliers de la race courante jusqu'au niveau atteint.
		const me = member.guild.members.me;
		for (const roleId of keep) {
			if (member.roles.cache.has(roleId)) continue;
			const role =
				member.guild.roles.cache.get(roleId) ??
				(await member.guild.roles.fetch(roleId).catch(() => null));
			if (!role) continue;
			if (me && role.position >= me.roles.highest.position) continue;
			await member.roles
				.add(roleId, `Paliers ${race}`)
				.catch((err) => logger.warn({ err, roleId }, "race level role add failed"));
		}

		const current = raceLevelRoleIds(race, level).at(-1) ?? null;
		await this.db
			.update(users)
			.set({ currentLevelRoleId: current, updatedAt: new Date() })
			.where(eq(users.id, member.id));
	}

	/**
	 * Passe TOUS les membres humains de la guilde par {@link syncRaceLevelRoles}.
	 * Appelé par le cron `level-role-reconcile` (events/LevelRoleSync.ts) pour
	 * rattraper les paliers manqués pendant un downtime, après une refonte des
	 * échelles, ou pour un membre dont le rôle de race a été posé à la main.
	 *
	 * Séquentiel volontairement : `syncRaceLevelRoles` fait des appels REST
	 * (add/remove de rôles) et paralléliser sur toute la guilde déclencherait le
	 * rate-limit global. En régime établi la passe ne coûte quasi rien (early
	 * return si la race n'a pas d'échelle, skip des rôles déjà posés).
	 *
	 * Une erreur sur un membre (rôle au-dessus du bot, membre parti en cours de
	 * route) n'interrompt pas la passe : elle est comptée et loguée.
	 */
	async reconcileAllRaceLevelRoles(
		guild: Guild
	): Promise<{ scanned: number; synced: number; failed: number }> {
		let scanned = 0;
		let synced = 0;
		let failed = 0;

		for (const member of guild.members.cache.values()) {
			if (member.user.bot) continue;
			scanned++;
			try {
				await this.syncRaceLevelRoles(member);
				synced++;
			} catch (err) {
				failed++;
				logger.warn({ err, memberId: member.id }, "race level role reconcile failed");
			}
		}

		return { scanned, synced, failed };
	}
}
