import type { GuildMember } from "discord.js";
import type { SettingsService } from "~/services/SettingsService";

/**
 * Un membre est "booster serveur" si :
 *  - `member.premiumSince` est défini (boost Discord natif), OU
 *  - il porte le rôle configuré dans `role.booster` (rôle "Héros du peuple"
 *    custom — utile si l'admin nomme manuellement un booster sans Nitro).
 */
async function isBooster(member: GuildMember, settings: SettingsService): Promise<boolean> {
	if (member.premiumSince) return true;
	const roleId = await settings.getRaw("role.booster");
	if (roleId && member.roles.cache.has(roleId)) return true;
	return false;
}

/**
 * Multiplier XP appliqué automatiquement aux boosters serveur.
 * Setting `xp.boost.boosters` (float, default 2.0). Désactivable en mettant 1.
 */
export async function boosterXpMultiplier(
	member: GuildMember,
	settings: SettingsService
): Promise<number> {
	if (!(await isBooster(member, settings))) return 1;
	const mult = await settings.getFloat("xp.boost.boosters", 2.0);
	return mult >= 1 ? mult : 1;
}
