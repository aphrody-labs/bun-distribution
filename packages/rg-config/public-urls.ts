// SPDX-License-Identifier: Apache-2.0
// Source: packages/shenron/config/src/public-urls.ts at 8172f535ce (preserved Git ancestry).
/**
 * Single source of truth for Shenron's public origins: site, bot API and the
 * asset/CDN base. Both apps used to resolve these with their own
 * `process.env.X ?? "https://…"` copies and divergent variable names
 * (`SITE_PUBLIC_URL`, `API_PUBLIC_URL`, `NEXT_PUBLIC_SHENRON_ASSETS_URL`, …).
 *
 * Each origin has ONE canonical server variable (`SHENRON_PUBLIC_*`); the
 * historical names stay accepted as read fallbacks, first non-empty wins:
 *
 * | origin | canonical                   | read order                                                                                   |
 * | ------ | --------------------------- | -------------------------------------------------------------------------------------------- |
 * | site   | `SHENRON_PUBLIC_SITE_URL`   | `NEXT_PUBLIC_SITE_URL`, canonical, `SITE_PUBLIC_URL`, `BETTER_AUTH_URL`                    |
 * | api    | `SHENRON_PUBLIC_API_URL`    | `NEXT_PUBLIC_SHENRON_API_URL`, canonical, `API_PUBLIC_URL`, `SHENRON_API_URL`              |
 * | assets | `SHENRON_PUBLIC_ASSETS_URL` | `NEXT_PUBLIC_SHENRON_ASSETS_URL`, canonical, then the api origin                           |
 *
 * The `NEXT_PUBLIC_*` mirror is read first because it is the value Next bakes
 * into client bundles: server and client must resolve the same origin.
 *
 * The production values are owned by the aphrody-infra service catalog; the
 * defaults below only keep a process without environment usable and are the
 * one place in the workspace allowed to spell them.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` on literal access, so the
 * resolvers take an explicit env record instead of reading a global: client
 * code passes its literal `process.env.NEXT_PUBLIC_…` values.
 *
 * Runtime class: `pure` (no global access).
 */

export type PublicUrlEnv = Readonly<Record<string, string | undefined>>;

export const PUBLIC_URL_ENV = {
  site: ["NEXT_PUBLIC_SITE_URL", "SHENRON_PUBLIC_SITE_URL", "SITE_PUBLIC_URL", "BETTER_AUTH_URL"],
  api: ["NEXT_PUBLIC_SHENRON_API_URL", "SHENRON_PUBLIC_API_URL", "API_PUBLIC_URL", "SHENRON_API_URL"],
  assets: ["NEXT_PUBLIC_SHENRON_ASSETS_URL", "SHENRON_PUBLIC_ASSETS_URL"],
} as const satisfies Record<string, readonly string[]>;

/** Fallback origins used only when no variable is set. */
export const DEFAULT_PUBLIC_ORIGINS = {
  site: "https://dragonballfr.com",
  api: "https://bot.dragonballfr.com",
  /** Dedicated object-storage CDN for heavy assets (manga pages, wiki art). */
  cdn: "https://cdn.dragonballfr.com",
} as const;

const trimSlash = (u: string): string => u.replace(/\/+$/, "");

function firstSet(env: PublicUrlEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value && value !== "undefined" && value !== "null") return trimSlash(value);
  }
  return undefined;
}

/** Public site origin, without trailing slash. */
export function resolveSiteUrl(env: PublicUrlEnv): string {
  return firstSet(env, PUBLIC_URL_ENV.site) ?? DEFAULT_PUBLIC_ORIGINS.site;
}

/** Public bot API origin, without trailing slash. */
export function resolveApiUrl(env: PublicUrlEnv): string {
  return firstSet(env, PUBLIC_URL_ENV.api) ?? DEFAULT_PUBLIC_ORIGINS.api;
}

/** Base of the self-hosted assets (defaults to the api origin), without trailing slash. */
export function resolveAssetsUrl(env: PublicUrlEnv): string {
  return firstSet(env, PUBLIC_URL_ENV.assets) ?? resolveApiUrl(env);
}

/** Joins `path` onto `base`, collapsing duplicate slashes at the seam. */
export function joinUrl(base: string, path = ""): string {
  const b = trimSlash(base);
  return path ? `${b}/${path.replace(/^\/+/, "")}` : b;
}

/** Origin (scheme + host) of a URL, or the input unchanged if unparsable. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Mirror host for a failed asset URL: the CDN and the bot serve the same
 * `/assets/**` tree, so a network error on one retries the other. Returns
 * `null` when the URL is on neither host.
 */
export function assetMirrorUrl(
  url: string,
  cdnOrigin: string = DEFAULT_PUBLIC_ORIGINS.cdn,
  apiOrigin: string = DEFAULT_PUBLIC_ORIGINS.api,
): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const cdn = new URL(cdnOrigin).host;
  const api = new URL(apiOrigin).host;
  if (u.host === cdn) u.host = api;
  else if (u.host === api) u.host = cdn;
  else return null;
  return u.toString();
}

/** Discord's public media CDN (fixed by Discord, not deployment-specific). */
export const DISCORD_CDN = "https://cdn.discordapp.com";

/** Default Discord avatar (`embed/avatars/<0..5>.png`) for a snowflake user id. */
export function discordDefaultAvatar(userId: string): string {
  let idx = 0;
  try {
    idx = Number((BigInt(userId) >> 22n) % 6n);
  } catch {
    idx = 0;
  }
  return `${DISCORD_CDN}/embed/avatars/${idx}.png`;
}

/** Discord media hosts serving avatars, banners and signed attachments. */
export const DISCORD_MEDIA_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"] as const;

/** Structural subset of Next's `images.remotePatterns` entry (no `next` import here). */
export interface RemoteImagePattern {
  protocol: "https" | "http";
  hostname: string;
  pathname: string;
}

function patternFor(origin: string, pathname: string): RemoteImagePattern | null {
  try {
    const u = new URL(origin);
    const protocol = u.protocol === "http:" ? "http" : "https";
    const base = u.pathname.replace(/\/+$/, "");
    return { protocol, hostname: u.hostname, pathname: `${base}${pathname}` };
  } catch {
    return null;
  }
}

/**
 * `next/image` remote patterns for Shenron's own origins, derived from the same
 * resolution as {@link resolveApiUrl} / {@link resolveAssetsUrl} /
 * {@link resolveSiteUrl}, plus the CDN mirror and Discord media. Duplicates
 * (assets base == api origin) are removed.
 */
export function ownImageRemotePatterns(env: PublicUrlEnv): RemoteImagePattern[] {
  const api = resolveApiUrl(env);
  const site = resolveSiteUrl(env);
  const candidates = [
    patternFor(DEFAULT_PUBLIC_ORIGINS.cdn, "/assets/**"),
    patternFor(resolveAssetsUrl(env), "/assets/**"),
    patternFor(api, "/db/**"),
    patternFor(api, "/assets/**"),
    // Full Color pages: stable URL answering a 302 to Discord's signed CDN.
    patternFor(api, "/api/public/manga/couleur/**"),
    patternFor(site, "/db/**"),
    patternFor(site, "/assets/**"),
    ...DISCORD_MEDIA_HOSTS.map(h => patternFor(`https://${h}`, "/**")),
  ];
  const seen = new Set<string>();
  const out: RemoteImagePattern[] = [];
  for (const p of candidates) {
    if (!p) continue;
    const key = `${p.protocol}://${p.hostname}${p.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export type DiscordImageSize = 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;

/** Public guild icon, retaining animated Discord hashes. */
export function discordGuildIcon(
  guildId: string,
  hash: string | null | undefined,
  opts: { size?: DiscordImageSize; fmt?: DiscordStaticFormat } = {},
): string | null {
  if (!hash) return null;
  return `${DISCORD_CDN}/icons/${guildId}/${hash}.${hash.startsWith("a_") ? "gif" : (opts.fmt ?? "webp")}?size=${opts.size ?? 256}`;
}
export type DiscordStaticFormat = "webp" | "png" | "jpg";

/** URL of a Discord user avatar (`a_` hashes are animated → gif), or the default avatar. */
export function discordUserAvatar(
  userId: string,
  hash: string | null | undefined,
  opts: { size?: DiscordImageSize; fmt?: DiscordStaticFormat } = {},
): string {
  if (!hash) return discordDefaultAvatar(userId);
  const ext = hash.startsWith("a_") ? "gif" : (opts.fmt ?? "webp");
  return `${DISCORD_CDN}/avatars/${userId}/${hash}.${ext}?size=${opts.size ?? 256}`;
}

/** URL of a Discord user banner, or `null` without a hash. */
export function discordUserBanner(
  userId: string,
  hash: string | null | undefined,
  opts: { size?: DiscordImageSize; fmt?: DiscordStaticFormat } = {},
): string | null {
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : (opts.fmt ?? "webp");
  return `${DISCORD_CDN}/banners/${userId}/${hash}.${ext}?size=${opts.size ?? 1024}`;
}

/** Discord's fixed default avatar by index (`embed/avatars/<index>.png`). */
export function discordEmbedAvatar(index: number): string {
  return `${DISCORD_CDN}/embed/avatars/${index}.png`;
}
