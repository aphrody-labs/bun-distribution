/**
 * Helpers d'URL d'avatar Discord.
 *
 * Discord invalide les anciennes URLs dès qu'un user change d'avatar (hash CDN).
 * On normalise les extensions animées et on fournit un fallback embed stable.
 */

import type { ImageURLOptions, User as DiscordUser } from "discord.js";

const EMBED = "https://cdn.discordapp.com/embed/avatars";
const AVATAR_CDN = "https://cdn.discordapp.com/avatars";

/** Index 0–5 du avatar par défaut Discord (formule snowflake moderne). */
export function discordDefaultAvatarIndex(userId: string): number {
	try {
		return Number((BigInt(userId) >> 22n) % 6n);
	} catch {
		return 0;
	}
}

export function discordDefaultAvatarUrl(userId: string): string {
	return `${EMBED}/${discordDefaultAvatarIndex(userId)}.png`;
}

/**
 * Options canoniques pour `displayAvatarURL` :
 * - taille raisonnable pour le web
 * - animé (gif) si applicable
 */
export const DISCORD_AVATAR_OPTS: ImageURLOptions = {
	size: 256,
	forceStatic: false,
	extension: undefined,
};

/** URL fraîche depuis un objet Discord.js. */
export function freshDiscordAvatarUrl(user: Pick<DiscordUser, "displayAvatarURL" | "id">): string {
	try {
		return user.displayAvatarURL(DISCORD_AVATAR_OPTS) || discordDefaultAvatarUrl(user.id);
	} catch {
		return discordDefaultAvatarUrl(user.id);
	}
}

/**
 * Normalise une URL stockée :
 * - avatar animé (`a_…`) forcé en `.gif` (webp/png cassent souvent)
 * - hash nu → URL CDN complète
 * - vide / invalide → embed default
 */
export function resolveDiscordAvatarUrl(
	userId: string | null | undefined,
	avatar: string | null | undefined
): string {
	const id = userId?.trim() || "0";
	const raw = (avatar ?? "").trim();
	if (!raw) return discordDefaultAvatarUrl(id);

	// Hash nu (sans http) : `a_xxx` ou `xxx`
	if (!/^https?:\/\//i.test(raw)) {
		const hash = raw.replace(/\.(gif|png|webp|jpg|jpeg)$/i, "");
		const ext = hash.startsWith("a_") ? "gif" : "webp";
		return `${AVATAR_CDN}/${id}/${hash}.${ext}?size=256`;
	}

	// Animé stocké en webp/png → gif
	const fixed = raw.replace(
		/(\/avatars\/\d+\/a_[a-f0-9]+)\.(webp|png|jpg|jpeg)(\?[^#]*)?$/i,
		"$1.gif$3"
	);

	// Ajoute size si absent (cache-friendly, cohérent)
	if (/cdn\.discordapp\.com\/avatars\//i.test(fixed) && !/[?&]size=/.test(fixed)) {
		return fixed.includes("?") ? `${fixed}&size=256` : `${fixed}?size=256`;
	}

	return fixed;
}
