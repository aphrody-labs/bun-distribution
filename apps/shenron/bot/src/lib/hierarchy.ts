/**
 * Hiérarchie modération configurable.
 *
 * Le setting `moderation.hierarchy` contient un JSON `string[][]` où chaque
 * entrée représente un **niveau** de staff, **du plus haut au plus bas** :
 *
 *   [
 *     ["roleId_owner_role", "roleId_admin_role"],   // niveau 0 — top
 *     ["roleId_lead_mod"],                          // niveau 1
 *     ["roleId_mod_basique", "roleId_helper"],      // niveau 2
 *   ]
 *
 * Règle : un membre **ne peut sanctionner que** quelqu'un dont le niveau
 * effectif est **strictement plus grand** (index numérique plus grand) que
 * le sien. Les membres sans aucun rôle staff = niveau `Infinity` (= tout en
 * bas) — sanctionnables par n'importe qui à ModOnly.
 *
 * Le **propriétaire** (`OWNER_ID`) et le **bot-dev** (`BOT_DEV_ID`) bypassent
 * tout check : ils peuvent sanctionner n'importe qui.
 */
import type { GuildMember, Role } from "discord.js";
import { container } from "tsyringe";
import { isBotOwner } from "./env";
import { SettingsService } from "~/services/SettingsService";
import { logger } from "./logger";

type Hierarchy = string[][];

let cachedRaw: string | undefined;
let cachedParsed: Hierarchy = [];

/**
 * Charge et parse la hiérarchie depuis SettingsService (cache 30s côté
 * service, on parse à chaque changement). Memoization locale du dernier raw.
 */
async function loadHierarchy(): Promise<Hierarchy> {
	const settings = container.resolve(SettingsService);
	const raw = (await settings.getRaw("moderation.hierarchy")) ?? "[]";
	if (raw === cachedRaw) return cachedParsed;
	cachedRaw = raw;
	try {
		const parsed = JSON.parse(raw);
		if (
			!Array.isArray(parsed) ||
			!parsed.every((lvl) => Array.isArray(lvl) && lvl.every((r) => typeof r === "string"))
		) {
			logger.warn({ raw }, "moderation.hierarchy: format invalide, fallback []");
			cachedParsed = [];
		} else {
			cachedParsed = parsed as Hierarchy;
		}
	} catch (err) {
		logger.warn({ err, raw }, "moderation.hierarchy: JSON invalide");
		cachedParsed = [];
	}
	return cachedParsed;
}

/**
 * Retourne le niveau d'un membre (index du premier match dans la hiérarchie,
 * 0 = top). `Infinity` si aucun rôle staff trouvé.
 */
function levelOf(member: GuildMember, hierarchy: Hierarchy): number {
	for (let i = 0; i < hierarchy.length; i++) {
		const roles = hierarchy[i]!;
		for (const roleId of roles) {
			if (member.roles.cache.has(roleId)) return i;
		}
	}
	return Infinity;
}

/**
 * Vérifie si `mod` peut sanctionner `target`.
 *
 * Règles :
 *  - Owner / BotDev → autorisé (peu importe `target`).
 *  - `target` est owner / botdev → refusé (sauf si appelant est owner).
 *  - `target` est le propriétaire du serveur Discord → refusé (sauf si appelant est owner du serveur).
 *  - Discord Native Hierarchy : mod.roles.highest.position <= target.roles.highest.position (sauf si owner du serveur).
 *  - Bot Discord Hierarchy : bot.roles.highest.position <= target.roles.highest.position.
 *  - Hiérarchie staff configurable : `mod.level < target.level` (mod hiérarchiquement plus haut).
 */
export async function canModerate(
	mod: GuildMember,
	target: GuildMember
): Promise<{ ok: boolean; reason?: string }> {
	const isOwner = isBotOwner(mod.id);
	if (isOwner) return { ok: true };
	if (isBotOwner(target.id)) {
		return { ok: false, reason: "Cible protégée (propriétaire / bot-dev)." };
	}
	if (target.id === mod.id) {
		return { ok: false, reason: "Tu ne peux pas te sanctionner toi-même." };
	}

	// Protection du propriétaire du serveur Discord
	if (target.id === target.guild.ownerId) {
		return { ok: false, reason: "Impossible de sanctionner le propriétaire du serveur." };
	}

	// Hiérarchie native Discord : le modérateur doit avoir un rôle supérieur à la cible (sauf s'il est l'owner du serveur)
	if (mod.id !== mod.guild.ownerId) {
		if (mod.roles.highest.position <= target.roles.highest.position) {
			return {
				ok: false,
				reason: `Hiérarchie Discord : le rôle le plus haut de ta cible (${target.roles.highest.name}) est supérieur ou égal au tien (${mod.roles.highest.name}).`,
			};
		}
	}

	// Hiérarchie Discord du bot : le bot ne peut pas modérer quelqu'un au-dessus de lui
	const botMember = mod.guild.members.me ?? (await mod.guild.members.fetchMe().catch(() => null));
	if (botMember && botMember.roles.highest.position <= target.roles.highest.position) {
		return {
			ok: false,
			reason: `Hiérarchie Discord : le rôle le plus haut de ta cible (${target.roles.highest.name}) est supérieur ou égal au rôle du bot (${botMember.roles.highest.name}).`,
		};
	}

	// Hiérarchie configurable (staff Shenron)
	const hierarchy = await loadHierarchy();
	if (hierarchy.length === 0) return { ok: true }; // pas de hiérarchie configurée → autorise (compat)
	const modLvl = levelOf(mod, hierarchy);
	const targetLvl = levelOf(target, hierarchy);
	if (modLvl === Infinity) {
		return {
			ok: false,
			reason: "Tu n'as aucun rôle dans la hiérarchie staff.",
		};
	}
	if (modLvl >= targetLvl) {
		return {
			ok: false,
			reason: `Hiérarchie : ta cible est au niveau \`${
				targetLvl === Infinity ? "—" : targetLvl
			}\`, tu es au niveau \`${modLvl}\`. Tu ne peux sanctionner que des membres de niveau strictement supérieur (index numérique plus grand).`,
		};
	}
	return { ok: true };
}

/**
 * Vérifie si un modérateur peut attribuer ou retirer un rôle donné à un membre.
 *
 * Règles :
 *  - Owner / BotDev → autorisé (sauf si rôle bot hierarchy l'empêche techniquement).
 *  - Bot Discord Hierarchy : bot.roles.highest.position <= role.position → bloqué.
 *  - Modérateur Discord Hierarchy : mod.roles.highest.position <= role.position (sauf si owner du serveur).
 *  - Si target fourni : vérifie canModerate(mod, target).
 */
export async function canManageRole(
	mod: GuildMember,
	role: Role,
	target?: GuildMember | null
): Promise<{ ok: boolean; reason?: string }> {
	const isOwner = isBotOwner(mod.id);

	// Vérification de position du bot
	const botMember = mod.guild.members.me ?? (await mod.guild.members.fetchMe().catch(() => null));
	if (botMember && role.position >= botMember.roles.highest.position) {
		return {
			ok: false,
			reason: `Hiérarchie Discord : le rôle ${role} (position ${role.position}) est supérieur ou égal à celui du bot (${botMember.roles.highest.position}). Déplace le rôle du bot plus haut.`,
		};
	}

	// Vérification de position du modérateur (sauf Owner bot ou Server Owner)
	if (!isOwner && mod.id !== mod.guild.ownerId) {
		if (role.position >= mod.roles.highest.position) {
			return {
				ok: false,
				reason: `Hiérarchie Discord : tu ne peux pas gérer un rôle (${role.name}) supérieur ou égal à ton plus haut rôle (${mod.roles.highest.name}).`,
			};
		}
	}

	// Vérification sur la cible si fournie
	if (target) {
		const allowed = await canModerate(mod, target);
		if (!allowed.ok) {
			return allowed;
		}
	}

	return { ok: true };
}

