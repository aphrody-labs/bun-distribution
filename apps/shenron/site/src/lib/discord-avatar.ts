/**
 * Discord avatar URLs (client-safe, no dependency).
 *
 * A custom avatar URL (`cdn.discordapp.com/avatars/<id>/<hash>.png`) embeds a
 * hash that Discord invalidates as soon as the member changes picture: the
 * stored URL then answers 404. Discord always serves the member's *default*
 * avatar, which only depends on the user id, so it is the natural fallback.
 */

import { DISCORD_MEDIA_HOSTS, discordEmbedAvatar } from "@shenron/config/public-urls";

/** A Discord snowflake: 64-bit integer written in base 10 (17 to 20 digits today). */
const SNOWFLAKE_RE = /^\d{15,21}$/;

/**
 * User id embedded in a Discord CDN avatar URL, or `null`.
 *
 * Handles user avatars (`/avatars/<user>/<hash>`) and per-guild avatars
 * (`/guilds/<guild>/users/<user>/avatars/<hash>`), on both CDN hosts.
 */
export function discordUserIdFromAvatarUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (!(DISCORD_MEDIA_HOSTS as readonly string[]).includes(parsed.hostname)) {
		return null;
	}
	const match =
		/^\/avatars\/(\d+)\//.exec(parsed.pathname) ??
		/^\/guilds\/\d+\/users\/(\d+)\/avatars\//.exec(parsed.pathname);
	const id = match?.[1];
	return id && SNOWFLAKE_RE.test(id) ? id : null;
}

/**
 * Index (0-5) of the default avatar Discord assigns to a user.
 *
 * Since the 2023 username migration the index is `(id >> 22) % 6` — the
 * timestamp part of the snowflake. The legacy `discriminator % 5` rule only
 * applies to accounts that still have a discriminator, which the site never
 * receives. `BigInt` is required: ids exceed `Number.MAX_SAFE_INTEGER`.
 */
export function discordDefaultAvatarIndex(userId: string | null | undefined): number | null {
	const id = userId?.trim();
	if (!id || !SNOWFLAKE_RE.test(id)) return null;
	return Number((BigInt(id) >> 22n) % 6n);
}

/** URL of the member's default Discord avatar, or `null` when the id is not a snowflake. */
export function discordDefaultAvatarUrl(userId: string | null | undefined): string | null {
	const index = discordDefaultAvatarIndex(userId);
	return index === null ? null : discordEmbedAvatar(index);
}
