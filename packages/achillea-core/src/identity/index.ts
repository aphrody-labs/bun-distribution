/**
 * Identité visuelle d'un joueur — URLs d'avatar et slugs d'images de rang.
 *
 * Fonctions pures : aucun accès au DOM. Le repli sur erreur de chargement
 * (`<img onerror>`) reste du ressort de chaque front, qui appelle
 * `discordDefaultAvatarUrl` pour obtenir l'URL de secours.
 */

import { euclideanMod, toPositiveInt } from "../numbers/index";

const EMBED_CDN = "https://cdn.discordapp.com/embed/avatars";
const AVATAR_CDN = "https://cdn.discordapp.com/avatars";

/** Index d'avatar par défaut Discord (snowflake >> 22) % 6. */
export function discordDefaultAvatarIndex(userId: string): number {
  try {
    // Modulo euclidien : `-1n % 6n` vaut `-1n` en JavaScript, pas `5n`, et un
    // index négatif pointait hors de la liste d'avatars par défaut.
    return Number(euclideanMod(Number(BigInt(userId) >> 22n), 6));
  } catch {
    return 0;
  }
}

export function discordDefaultAvatarUrl(userId: string): string {
  return `${EMBED_CDN}/${discordDefaultAvatarIndex(userId)}.png`;
}

/**
 * Résout l'URL d'avatar d'un joueur, que `avatar` soit un hash Discord ou une
 * URL complète. Les URLs CDN expirent quand le joueur change d'avatar :
 * toujours prévoir `discordDefaultAvatarUrl` en repli côté rendu.
 */
export function resolveDiscordAvatarUrl(
  userId: string | null | undefined,
  avatar: string | null | undefined,
  size = 256,
): string {
  const width = toPositiveInt(size, 256, 16);
  const raw = (avatar ?? "").trim();
  const extractedId = raw.match(/\/avatars\/(\d+)\//iu)?.[1];
  const id = userId?.trim() || extractedId || "0";
  if (!raw) return discordDefaultAvatarUrl(id);

  if (!/^https?:\/\//iu.test(raw)) {
    const hash = raw.replace(/\.(gif|png|webp|jpg|jpeg)$/iu, "");
    const ext = hash.startsWith("a_") ? "gif" : "webp";
    return `${AVATAR_CDN}/${id}/${hash}.${ext}?size=${width}`;
  }

  // Un avatar animé servi en .webp reste figé : forcer .gif.
  const fixed = raw.replace(/(\/avatars\/\d+\/a_[a-f0-9]+)\.(webp|png|jpg|jpeg)(\?[^#]*)?$/iu, "$1.gif$3");

  if (/cdn\.discordapp\.com\/avatars\//iu.test(fixed) && !/[?&]size=/u.test(fixed)) {
    return fixed.includes("?") ? `${fixed}&size=${width}` : `${fixed}?size=${width}`;
  }

  return fixed;
}

/**
 * Clé de rang FR (telle que stockée) → slug ASCII du fichier image.
 * 11 paliers Achilléa (Fer → Légendaire, Rubis inclus).
 */
export const RANK_IMAGE_SLUG: Readonly<Record<string, string>> = {
  "non classé": "fer",
  "non classe": "fer",
  fer: "fer",
  bronze: "bronze",
  argent: "argent",
  or: "or",
  platine: "platine",
  diamant: "diamant",
  émeraude: "emeraude",
  emeraude: "emeraude",
  rubis: "rubis",
  divin: "divin",
  supernova: "supernova",
  légendaire: "legendaire",
  legendaire: "legendaire",
};

export const DEFAULT_RANK_SLUG = "fer";

/** Slug d'image pour une clé de rang, insensible à la casse et aux accents. */
export function rankImageSlug(key: string | null | undefined): string {
  if (!key) return DEFAULT_RANK_SLUG;
  return RANK_IMAGE_SLUG[key.toLowerCase().normalize("NFKC")] ?? DEFAULT_RANK_SLUG;
}

/**
 * Chemin de l'image de rang, relatif par défaut (`ranks/or.webp`).
 * Passer `basePath` pour préfixer avec un CDN ou une route absolue.
 */
export function rankImagePath(key: string | null | undefined, basePath = "ranks"): string {
  const base = basePath.replace(/\/$/u, "");
  return `${base}/${rankImageSlug(key)}.webp`;
}

/** Extracts the first non-empty path segment from a social profile URL. */
export function socialProfileUsername(urlString: string): string {
  try {
    return new URL(urlString).pathname.split("/").find(Boolean) ?? "";
  } catch {
    return "";
  }
}
