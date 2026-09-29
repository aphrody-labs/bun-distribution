import { singleton, inject } from "tsyringe";
import type { Guild, GuildMember, Role } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { SettingsService } from "./SettingsService";
import { logger } from "~/lib/logger";

/**
 * Attribution / retrait du rôle "Fusion" — couplé à la setting `role.fusion`.
 *
 * Garde-fous (alignés sur `level-reward-set`) :
 *   - Si la setting n'est pas définie → no-op silencieux.
 *   - Si le rôle n'existe plus → log warn + skip.
 *   - Si le bot n'a pas `MANAGE_ROLES` → log warn + skip.
 *   - Si le rôle est ≥ position du rôle highest du bot → log warn + skip
 *     (sinon Discord rejette silencieusement).
 *   - `members.fetch` peut échouer (membre parti) → catch + skip individuel.
 *
 * Idempotent : `roles.add`/`roles.remove` no-op si l'état est déjà correct.
 */
@singleton()
export class FusionRoleService {
	constructor(@inject(SettingsService) private settings: SettingsService) {}

	/** Résout le rôle configuré, ou `null` + log si invalide / bot pas autorisé. */
	private async resolveRole(guild: Guild): Promise<Role | null> {
		const roleId = await this.settings.getSnowflake("role.fusion");
		if (!roleId) return null;

		const role =
			guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
		if (!role) {
			logger.warn({ roleId }, "fusion-role: role introuvable, skip");
			return null;
		}

		const me = guild.members.me;
		if (!me) {
			logger.warn("fusion-role: guild.members.me indisponible, skip");
			return null;
		}
		if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
			logger.warn({ roleId }, "fusion-role: bot sans MANAGE_ROLES, skip");
			return null;
		}
		if (me.roles.highest.comparePositionTo(role) <= 0) {
			logger.warn(
				{ roleId, rolePos: role.position, botPos: me.roles.highest.position },
				"fusion-role: role au-dessus du bot, skip"
			);
			return null;
		}
		return role;
	}

	/** Applique le rôle aux deux membres (catch individuel). */
	async applyToPair(guild: Guild, userIdA: string, userIdB: string): Promise<void> {
		const role = await this.resolveRole(guild);
		if (!role) return;
		for (const id of [userIdA, userIdB]) {
			const member = await guild.members.fetch(id).catch(() => null);
			if (!member) {
				logger.warn({ userId: id }, "fusion-role: member introuvable, skip");
				continue;
			}
			if (member.roles.cache.has(role.id)) continue;
			await member.roles
				.add(role.id, "Fusion active")
				.catch((err) => logger.warn({ err, userId: id }, "fusion-role: add failed"));
		}
	}

	/** Retire le rôle aux deux membres (catch individuel). */
	async removeFromPair(guild: Guild, userIdA: string, userIdB: string): Promise<void> {
		const role = await this.resolveRole(guild);
		if (!role) return;
		for (const id of [userIdA, userIdB]) {
			const member = await guild.members.fetch(id).catch(() => null);
			if (!member) continue;
			if (!member.roles.cache.has(role.id)) continue;
			await member.roles
				.remove(role.id, "Fusion dissoute")
				.catch((err) => logger.warn({ err, userId: id }, "fusion-role: remove failed"));
		}
	}

	/** Helper alternatif — retire à un seul membre déjà résolu (utile sur leave). */
	async removeFromMember(member: GuildMember): Promise<void> {
		const role = await this.resolveRole(member.guild);
		if (!role) return;
		if (!member.roles.cache.has(role.id)) return;
		await member.roles
			.remove(role.id, "Fusion dissoute")
			.catch((err) => logger.warn({ err, userId: member.id }, "fusion-role: remove failed"));
	}
}
