/**
 * Helpers CDN Discord.
 * Doc : https://discord.com/developers/docs/reference#image-formatting
 *
 * Hash préfixé `a_` = animé → utiliser `gif` pour l'animation, sinon `webp`.
 * Sizes valides : 16, 32, 64, 128, 256, 512, 1024, 2048, 4096.
 */

import { DISCORD_CDN as CDN } from "@shenron/config/public-urls";

type Size = 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;
type StaticFmt = "webp" | "png" | "jpg";
type AnyFmt = StaticFmt | "gif";

function pickFmt(hash: string | null | undefined, fmt: StaticFmt): AnyFmt {
	return hash?.startsWith("a_") ? "gif" : fmt;
}

export function userAvatar(
	userId: string,
	hash: string | null | undefined,
	opts: { size?: Size; fmt?: StaticFmt } = {}
): string {
	if (!hash) return defaultAvatar(userId);
	const f = pickFmt(hash, opts.fmt ?? "webp");
	return `${CDN}/avatars/${userId}/${hash}.${f}?size=${opts.size ?? 256}`;
}

export function defaultAvatar(userId: string): string {
	// Nouveau système (pas de discriminator) : (id >> 22) % 6
	const idx = Number((BigInt(userId) >> 22n) % 6n);
	return `${CDN}/embed/avatars/${idx}.png`;
}

function guildMemberAvatar(
	guildId: string,
	userId: string,
	hash: string | null | undefined,
	opts: { size?: Size; fmt?: StaticFmt } = {}
): string | null {
	if (!hash) return null;
	const f = pickFmt(hash, opts.fmt ?? "webp");
	return `${CDN}/guilds/${guildId}/users/${userId}/avatars/${hash}.${f}?size=${opts.size ?? 256}`;
}

export function guildIcon(
	guildId: string,
	hash: string | null | undefined,
	opts: { size?: Size; fmt?: StaticFmt } = {}
): string | null {
	if (!hash) return null;
	const f = pickFmt(hash, opts.fmt ?? "webp");
	return `${CDN}/icons/${guildId}/${hash}.${f}?size=${opts.size ?? 256}`;
}

function guildBanner(
	guildId: string,
	hash: string | null | undefined,
	opts: { size?: Size; fmt?: StaticFmt } = {}
): string | null {
	if (!hash) return null;
	const f = pickFmt(hash, opts.fmt ?? "webp");
	return `${CDN}/banners/${guildId}/${hash}.${f}?size=${opts.size ?? 1024}`;
}

function userBanner(
	userId: string,
	hash: string | null | undefined,
	opts: { size?: Size; fmt?: StaticFmt } = {}
): string | null {
	if (!hash) return null;
	const f = pickFmt(hash, opts.fmt ?? "webp");
	return `${CDN}/banners/${userId}/${hash}.${f}?size=${opts.size ?? 1024}`;
}

function emoji(emojiId: string, animated = false, size: Size = 64): string {
	return `${CDN}/emojis/${emojiId}.${animated ? "gif" : "webp"}?size=${size}`;
}

function roleIcon(
	roleId: string,
	hash: string | null | undefined,
	size: Size = 64
): string | null {
	if (!hash) return null;
	return `${CDN}/role-icons/${roleId}/${hash}.png?size=${size}`;
}
