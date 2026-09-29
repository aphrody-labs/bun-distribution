import { singleton, inject } from "tsyringe";
import { and, eq, isNull, sql, gte, desc } from "drizzle-orm";
import type { Guild, GuildMember } from "discord.js";
import { DatabaseService } from "~/db/index";
import { warns, jails, actionLogs, bans } from "~/db/schema";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";

@singleton()
export class ModerationService {
	constructor(@inject(DatabaseService) private dbs: DatabaseService) {}

	private get db() {
		return this.dbs.db;
	}

	async log(
		action: string,
		userId: string | null,
		moderatorId: string | null,
		reason?: string,
		meta?: unknown
	) {
		await this.db.insert(actionLogs).values({
			action,
			userId: userId ?? null,
			moderatorId: moderatorId ?? null,
			reason: reason ?? null,
			meta: meta ? JSON.stringify(meta) : null,
		});
	}

	// Warns
	async addWarn(userId: string, moderatorId: string, reason?: string) {
		await this.db.insert(warns).values({ userId, moderatorId, reason: reason ?? null });
		await this.log("WARN", userId, moderatorId, reason);
	}

	async removeLastWarn(userId: string): Promise<boolean> {
		const w = await this.db.query.warns.findFirst({
			where: and(eq(warns.userId, userId), eq(warns.active, true)),
			orderBy: (t, { desc }) => desc(t.createdAt),
		});
		if (!w) return false;
		await this.db.update(warns).set({ active: false }).where(eq(warns.id, w.id));
		await this.log("UNWARN", userId, null, `removed warn #${w.id}`);
		return true;
	}

	async countWarns(userId: string): Promise<number> {
		const [row] = await this.db
			.select({ c: sql<number>`count(*)` })
			.from(warns)
			.where(and(eq(warns.userId, userId), eq(warns.active, true)));
		return Number(row?.c ?? 0);
	}

	// Jail
	// On utilise `roles.add(jailRoleId)` plutôt que `roles.set([jailRoleId])` :
	// `set()` exige que le bot puisse retirer TOUS les rôles existants — si le
	// membre porte un rôle au-dessus du bot dans la hiérarchie, Discord refuse
	// l'opération entière (Missing Permissions). `add()` ne vérifie que la
	// hiérarchie du seul rôle ajouté. Le mute effectif est porté par les
	// overrides de salon posés par `/jail-setup` (deny ViewChannel/SendMessages
	// pour le rôle jail) : ils s'appliquent quels que soient les autres rôles
	// du membre car les `deny` battent les `allow` au même niveau.
	async jail(member: GuildMember, moderatorId: string, reason?: string, durationMs?: number) {
		const roleId = env.JAIL_ROLE_ID;
		if (!roleId) throw new Error("JAIL_ROLE_ID not configured");

		// Hiérarchie : refuser proprement avant l'appel REST plutôt que d'attendre
		// un Missing Permissions opaque côté Discord.
		const me = await member.guild.members.fetchMe();
		const jailRole = member.guild.roles.cache.get(roleId);
		if (jailRole && jailRole.position >= me.roles.highest.position) {
			throw new Error(
				`Le rôle jail (${jailRole.name}) est au-dessus du plus haut rôle du bot (${me.roles.highest.name}). Déplace-le dans Paramètres → Rôles.`
			);
		}

		const prev = member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.id);
		await this.db.insert(jails).values({
			userId: member.id,
			moderatorId,
			reason: reason ?? null,
			expiresAt: durationMs ? new Date(Date.now() + durationMs) : null,
			previousRoles: JSON.stringify(prev),
		});

		const botHighestPosition = me.roles.highest.position;
		const rolesToKeep = member.roles.cache
			.filter(
				(r) =>
					r.id === member.guild.id || // @everyone
					r.position >= botHighestPosition || // au-dessus du bot
					r.managed // booster, bot intégration, etc.
			)
			.map((r) => r.id);

		if (!rolesToKeep.includes(roleId)) {
			rolesToKeep.push(roleId);
		}

		try {
			await member.roles.set(rolesToKeep, `jail by ${moderatorId}`);
		} catch (err) {
			logger.warn(
				{ err, userId: member.id },
				"member.roles.set failed for jail, falling back to manual add/remove"
			);

			await member.roles.add(roleId, `jail by ${moderatorId}`).catch((addErr) => {
				logger.error({ err: addErr }, "Failed to add jail role");
				throw addErr;
			});

			const rolesToRemove = member.roles.cache.filter(
				(r) =>
					r.id !== member.guild.id &&
					r.id !== roleId &&
					r.position < botHighestPosition &&
					!r.managed
			);

			for (const r of rolesToRemove.values()) {
				await member.roles.remove(r.id, `jail by ${moderatorId}`).catch((remErr) => {
					logger.error({ err: remErr, roleId: r.id }, "Failed to remove role during jail fallback");
				});
			}
		}

		await this.log("JAIL", member.id, moderatorId, reason, { durationMs, previousRoles: prev });
	}

	async unjail(
		guild: Guild,
		userId: string,
		moderatorId: string,
		reason?: string
	): Promise<boolean> {
		const j = await this.db.query.jails.findFirst({
			where: and(eq(jails.userId, userId), isNull(jails.releasedAt)),
			orderBy: (t, { desc }) => desc(t.createdAt),
		});
		const member = await guild.members.fetch(userId).catch(() => null);
		if (!member && !j) return false;

		if (member) {
			const roleId = env.JAIL_ROLE_ID;
			const restore: string[] = j?.previousRoles ? (JSON.parse(j.previousRoles) as string[]) : [];

			const rolesToSet = member.roles.cache
				.filter((r) => r.id !== guild.id && r.id !== roleId)
				.map((r) => r.id);

			for (const r of restore) {
				if (!rolesToSet.includes(r)) {
					rolesToSet.push(r);
				}
			}

			try {
				await member.roles.set(rolesToSet, `unjail by ${moderatorId}`);
			} catch (err) {
				logger.warn({ err, userId }, "member.roles.set failed in unjail, falling back");
				if (roleId) await member.roles.remove(roleId).catch(() => {});
				for (const r of restore) {
					await member.roles.add(r).catch(() => {});
				}
			}
		}

		if (j) {
			await this.db.update(jails).set({ releasedAt: new Date() }).where(eq(jails.id, j.id));
		}
		await this.log("UNJAIL", userId, moderatorId, reason);
		return true;
	}

	async getActiveJail(userId: string) {
		return this.db.query.jails.findFirst({
			where: and(eq(jails.userId, userId), isNull(jails.releasedAt)),
			orderBy: (t, { desc }) => desc(t.createdAt),
		});
	}

	async manuallyJail(userId: string, moderatorId: string, previousRoles: string[]) {
		const active = await this.getActiveJail(userId);
		if (!active) {
			await this.db.insert(jails).values({
				userId,
				moderatorId,
				reason: "Manual role assignment",
				previousRoles: JSON.stringify(previousRoles),
			});
			await this.log("JAIL", userId, moderatorId, "Manual role assignment");
		}
	}

	// Bans persistants
	async addBan(userId: string, moderatorId: string, reason?: string) {
		const active = await this.getActiveBan(userId);
		if (!active) {
			await this.db.insert(bans).values({
				userId,
				moderatorId,
				reason: reason ?? null,
				active: true,
			});
		} else {
			await this.db
				.update(bans)
				.set({
					moderatorId,
					reason: reason ?? null,
					updatedAt: new Date(),
				})
				.where(eq(bans.id, active.id));
		}
		await this.log("BAN", userId, moderatorId, reason);
	}

	async removeBan(userId: string, moderatorId?: string, reason?: string): Promise<boolean> {
		const active = await this.getActiveBan(userId);
		if (!active) return false;
		await this.db
			.update(bans)
			.set({ active: false, updatedAt: new Date() })
			.where(eq(bans.id, active.id));
		await this.log("UNBAN", userId, moderatorId ?? null, reason);
		return true;
	}

	async getActiveBan(userId: string) {
		return this.db.query.bans.findFirst({
			where: and(eq(bans.userId, userId), eq(bans.active, true)),
			orderBy: (t, { desc }) => desc(t.createdAt),
		});
	}

	/** Warns actifs d'un membre — utilisé par /warns et le dashboard. */
	async listActiveWarns(userId: string) {
		return this.db
			.select()
			.from(warns)
			.where(and(eq(warns.userId, userId), eq(warns.active, true)))
			.orderBy(desc(warns.createdAt));
	}

	/** Tous les warns actifs (paginé) pour le dashboard. */
	async listAllActiveWarns(limit = 100, offset = 0) {
		const rows = await this.db
			.select()
			.from(warns)
			.where(eq(warns.active, true))
			.orderBy(desc(warns.createdAt))
			.limit(limit)
			.offset(offset);
		const [count] = await this.db
			.select({ c: sql<number>`count(*)` })
			.from(warns)
			.where(eq(warns.active, true));
		return { rows, total: Number(count?.c ?? 0), limit, offset };
	}

	/** Désactive un warn par id (admin/dashboard). */
	async unwarnById(warnId: number, moderatorId?: string): Promise<boolean> {
		const w = await this.db.query.warns.findFirst({
			where: and(eq(warns.id, warnId), eq(warns.active, true)),
		});
		if (!w) return false;
		await this.db.update(warns).set({ active: false }).where(eq(warns.id, warnId));
		await this.log("UNWARN", w.userId, moderatorId ?? null, `removed warn #${warnId}`);
		return true;
	}

	/** Purge tous les warns actifs d'un membre. Retourne le nb supprimé. */
	async clearWarns(userId: string, moderatorId: string): Promise<number> {
		const active = await this.db
			.select({ id: warns.id })
			.from(warns)
			.where(and(eq(warns.userId, userId), eq(warns.active, true)));
		if (active.length === 0) return 0;
		await this.db
			.update(warns)
			.set({ active: false })
			.where(and(eq(warns.userId, userId), eq(warns.active, true)));
		await this.log("CLEARWARNS", userId, moderatorId, undefined, { count: active.length });
		return active.length;
	}

	/** Jails actifs (releasedAt is null). Pour le dashboard. */
	async listActiveJails(limit = 100, offset = 0) {
		const rows = await this.db
			.select()
			.from(jails)
			.where(isNull(jails.releasedAt))
			.orderBy(desc(jails.createdAt))
			.limit(limit)
			.offset(offset);
		const [count] = await this.db
			.select({ c: sql<number>`count(*)` })
			.from(jails)
			.where(isNull(jails.releasedAt));
		return { rows, total: Number(count?.c ?? 0), limit, offset };
	}

	/** Bans actifs. Pour le dashboard. */
	async listActiveBans(limit = 100, offset = 0) {
		const rows = await this.db
			.select()
			.from(bans)
			.where(eq(bans.active, true))
			.orderBy(desc(bans.createdAt))
			.limit(limit)
			.offset(offset);
		const [count] = await this.db
			.select({ c: sql<number>`count(*)` })
			.from(bans)
			.where(eq(bans.active, true));
		return { rows, total: Number(count?.c ?? 0), limit, offset };
	}

	/** Note interne (pas de sanction Discord, pour traçabilité mod). */
	async note(userId: string, moderatorId: string, content: string) {
		await this.log("NOTE", userId, moderatorId, content);
	}

	/**
	 * Résumé des actions de modération sur la fenêtre `windowMs` (default 7 j).
	 * Renvoie le nombre d'occurrences par action — pour les KPIs du dashboard.
	 */
	async statsWindow(windowMs = 7 * 86_400_000) {
		const since = Date.now() - windowMs;
		const rows = await this.db
			.select({ action: actionLogs.action, c: sql<number>`count(*)` })
			.from(actionLogs)
			.where(gte(actionLogs.createdAt, new Date(since)))
			.groupBy(actionLogs.action);
		const out: Record<string, number> = {};
		for (const r of rows) out[r.action] = Number(r.c);
		return { windowMs, since, byAction: out };
	}

	/** Dernières N entrées d'audit (logs déjà filtrés par action whitelist). */
	async recentActions(limit = 50, actionsFilter?: string[]) {
		const q = this.db.select().from(actionLogs).orderBy(desc(actionLogs.createdAt)).limit(limit);
		const rows = await q;
		if (!actionsFilter?.length) return rows;
		const set = new Set(actionsFilter);
		return rows.filter((r) => set.has(r.action));
	}
}
