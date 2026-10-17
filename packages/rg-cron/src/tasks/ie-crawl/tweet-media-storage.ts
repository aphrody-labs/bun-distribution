/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Ré-hébergement des images de tweets dans Supabase Storage.
//
// POURQUOI RÉ-HÉBERGER
// Les URLs pbs.twimg.com ne sont pas des archives : X purge les médias des comptes
// supprimés et fait tourner ses CDN. Une galerie de campagne qui pointerait
// directement sur pbs afficherait des trous quelques mois plus tard. On recopie
// donc chaque image dans le bucket `tweets`, et la page sert l'origine du site
// (`/storage/v1` est relayé vers Supabase : zéro cross-origin).
//
// CONVENTIONS (identiques à scripts/ops/refetch-tweet-media.ts — ne pas dévier :
// ce script reconstruit le bucket depuis `tweets.media[n].original_url` en se
// fiant EXACTEMENT à ce nommage) :
//   objet : tweets/<tweetId>/<tweetId>_<n>.<ext>
//   n     : position du média dans `tweets.media`
//
// L'écriture passe par `televerserObjet` : sur le VPS (`RG_MEDIA_ROOT`, `rg-core`) le fichier va
// sur le disque des médias lourds servi par `cdn.rosegriffon.fr` ; sans cette racine, par l'API
// Storage, qui tient elle-même `storage.objects`.
//
// IDEMPOTENCE : si l'objet existe déjà, on ne retélécharge pas. La détection se
// fait par PRÉFIXE dans `storage.objects` (pas par nom exact), parce que
// l'extension dépend du content-type renvoyé par X et n'est donc pas connue avant
// le téléchargement — la deviner reviendrait à retélécharger à chaque passage.

import { createBunSql } from "@rosegriffon/db/bun-sql";
import type { SQL } from "bun";
import { fichierMedia, televerserObjet, urlPubliqueObjet } from "../../lib/storage-assets.js";
import type { MediaItem } from "./tweet-row";

const BUCKET = "tweets";

/**
 * Origine publique servant les fichiers. On vise l'origine du SITE (et non
 * storage.rosegriffon.fr) : nginx y expose `/storage/v1/` via supabase-compat.inc,
 * ce qui évite tout préflight CORS et permet à next/image de traiter l'URL comme
 * locale une fois relativisée côté front.
 */
const ORIGINE_PUBLIQUE = Bun.env.RG_STORAGE_PUBLIC_ORIGIN ?? "https://rosegriffon.fr";

/**
 * Types MIME acceptés par le bucket `tweets`. On restreint volontairement aux
 * images : ce module ne ré-héberge que des `photo`, jamais de vidéo.
 * (Le bucket accepte aussi video/mp4 et video/webm — hors périmètre ici.)
 */
const MIMES_IMAGE: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const TIMEOUT_TELECHARGEMENT_MS = 30_000;
const UA = "Mozilla/5.0 (compatible; rose-griffon-storage/1.0)";

export interface ResultatRehebergement {
  /** Chemin dans le bucket : `<tweetId>/<tweetId>_<n>.<ext>`. */
  chemin: string;
  /** URL publique complète. */
  url: string;
  octets: number;
  mime: string;
  /** Vrai si le fichier était déjà présent (aucun téléchargement effectué). */
  deja: boolean;
}

// Connexion Postgres paresseuse : le module est importable sans ouvrir de socket
// (utile pour les tests et pour un `--dry` qui n'écrit rien).
let sqlPartage: SQL | null = null;
function db(): SQL {
  if (!sqlPartage) sqlPartage = createBunSql();
  return sqlPartage;
}

/** Ferme la connexion Postgres du module (à appeler en fin de programme). */
export async function fermerStockage(): Promise<void> {
  if (sqlPartage) {
    await sqlPartage.end();
    sqlPartage = null;
  }
}

/**
 * pbs.twimg.com sert la meilleure définition raisonnable via `name=large`.
 * Logique reprise telle quelle de scripts/ops/refetch-tweet-media.ts pour que les
 * deux chemins d'acquisition téléchargent rigoureusement le même fichier.
 */
export function meilleureSourcePbs(url: string): string {
  if (!url.startsWith("https://pbs.twimg.com/")) return url;
  const u = new URL(url);
  u.searchParams.set("name", "large");
  if (!u.searchParams.has("format") && /\.(jpg|png|webp)$/.test(u.pathname)) {
    const ext = u.pathname.split(".").pop() as string;
    u.pathname = u.pathname.replace(/\.(jpg|png|webp)$/, "");
    u.searchParams.set("format", ext);
  }
  return u.toString();
}

/** URL publique d'un chemin du bucket. */
function urlPublique(chemin: string): string {
  return urlPubliqueObjet(BUCKET, chemin, ORIGINE_PUBLIQUE);
}

/**
 * Cherche un objet déjà présent pour ce (tweet, index), quelle que soit son
 * extension. Renvoie le chemin relatif au bucket, sa taille et son type, ou null.
 */
async function objetDejaPresent(
  tweetId: string,
  index: number,
): Promise<{ chemin: string; octets: number; mime: string } | null> {
  const motif = new RegExp(`^${tweetId}/${tweetId}_${index}\\.[a-z0-9]+$`, "i");
  const dossierDisque = fichierMedia(BUCKET, tweetId);
  if (dossierDisque) {
    const glob = new Bun.Glob(`${tweetId}_${index}.*`);
    for await (const nom of glob.scan({ cwd: dossierDisque, onlyFiles: true, throwErrorOnBrokenSymlink: false })) {
      const ext = nom.split(".").pop() ?? "jpg";
      const mime = Object.entries(MIMES_IMAGE).find(([, e]) => e === ext)?.[0] ?? "image/jpeg";
      return { chemin: `${tweetId}/${nom}`, octets: Bun.file(`${dossierDisque}/${nom}`).size, mime };
    }
    return null;
  }
  const lignes = (await db()`
		select name, metadata
		  from storage.objects
		 where bucket_id = ${BUCKET}
		   and name like ${`${tweetId}/%`}`) as {
    name: string;
    metadata: { size?: number; mimetype?: string } | null;
  }[];
  const trouve = lignes.find(ligne => motif.test(ligne.name));
  if (!trouve) return null;
  const ext = trouve.name.split(".").pop() ?? "jpg";
  const mime = trouve.metadata?.mimetype ?? Object.entries(MIMES_IMAGE).find(([, e]) => e === ext)?.[0] ?? "image/jpeg";
  return { chemin: trouve.name, octets: Number(trouve.metadata?.size ?? 0), mime };
}

/**
 * Télécharge une image et l'installe dans le bucket. Renvoie null en cas d'échec
 * (HTTP non-OK, timeout, type MIME refusé) — jamais d'exception : une image
 * indisponible ne doit pas faire tomber toute une récolte.
 */
export async function rehebergerImage(
  tweetId: string,
  index: number,
  sourceUrl: string,
): Promise<ResultatRehebergement | null> {
  // 1) Déjà là ? On ne retélécharge pas.
  try {
    const existant = await objetDejaPresent(tweetId, index);
    if (existant) return { ...existant, url: urlPublique(existant.chemin), deja: true };
  } catch {
    return null;
  }

  // 2) Téléchargement.
  try {
    const reponse = await fetch(meilleureSourcePbs(sourceUrl), {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_TELECHARGEMENT_MS),
    });
    if (!reponse.ok) return null;

    const mime = (reponse.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = MIMES_IMAGE[mime];
    // Le bucket refuse tout autre type : inutile d'écrire un fichier qui ne
    // serait jamais servi.
    if (!ext) return null;

    const contenu = await reponse.arrayBuffer();
    if (contenu.byteLength === 0) return null;

    const chemin = `${tweetId}/${tweetId}_${index}.${ext}`;
    const envoi = await televerserObjet(BUCKET, chemin, contenu, mime);
    if (!envoi.ok) return null;

    return { chemin, url: urlPublique(chemin), octets: contenu.byteLength, mime, deja: false };
  } catch {
    return null;
  }
}

/**
 * Ré-héberge toutes les IMAGES d'un tweet et renvoie le tableau `media` enrichi.
 *
 * Les entrées non-photo et celles déjà ré-hébergées sont renvoyées INTACTES, tout
 * comme celles dont le téléchargement échoue : le tableau conserve toujours sa
 * longueur et son ordre, puisque l'index `n` du nom de fichier en dépend.
 */
export async function rehebergerMediasTweet(
  tweetId: string,
  media: MediaItem[] | null | undefined,
): Promise<{ media: MediaItem[]; rehberges: number; telecharges: number }> {
  if (!Array.isArray(media) || media.length === 0) {
    return { media: [], rehberges: 0, telecharges: 0 };
  }

  const sortie: MediaItem[] = [];
  let rehberges = 0;
  let telecharges = 0;

  for (let i = 0; i < media.length; i++) {
    const item = media[i]!;
    if (item.type !== "photo") {
      sortie.push(item);
      continue;
    }

    // Test sur le CHEMIN, pas sur l'hôte : une URL déjà réécrite vers
    // rosegriffon.fr, azalee.rosegriffon.fr ou storage.rosegriffon.fr est
    // reconnue de la même façon (même convention que process-tweets.ts).
    const dejaHeberge = (item.url ?? "").includes(`storage/v1/object/public/${BUCKET}`);
    if (dejaHeberge) {
      sortie.push(item);
      continue;
    }

    const source = item.original_url ?? item.url ?? item.preview_url;
    if (!source) {
      sortie.push(item);
      continue;
    }

    const res = await rehebergerImage(tweetId, i, source);
    if (!res) {
      // Échec : on garde l'item d'origine, la galerie servira pbs.twimg.com.
      sortie.push(item);
      continue;
    }

    rehberges++;
    if (!res.deja) telecharges++;
    sortie.push({
      ...item,
      url: res.url,
      preview_url: res.url,
      previewUrl: res.url,
      // `original_url` doit rester l'URL pbs : c'est elle qui permet de
      // reconstruire le bucket si le stockage est perdu.
      original_url: item.original_url ?? source,
      storage_path: res.chemin,
      storage_url: res.url,
    });
  }

  return { media: sortie, rehberges, telecharges };
}
