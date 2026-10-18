/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ré-hébergement d'un fichier Discord dans Supabase Storage.
 *
 * POURQUOI CE FICHIER EXISTE
 * Toute image venue de Discord doit être RECOPIÉE avant d'être publiée : les URL
 * `cdn.discordapp.com` sont signées (`?ex=…&is=…&hm=…`) et expirent en moins de
 * 24 h — la même URL privée de sa query répond 404. Republier ce lien, c'est
 * publier une page qui casse le lendemain. La règle est déjà appliquée côté site
 * (`apps/website/src/lib/discord/url.ts` : `estUrlDiscordExpirante`,
 * `urlPubliableOuNull`), qui préfère ne rien montrer plutôt qu'un lien mort.
 *
 * La recopie était écrite en privé dans `tasks/discord-polls.ts` (visuels de
 * sondage). Elle sert désormais aussi aux créations de campagne : elle vit donc
 * ici, où n'importe quelle tâche peut la prendre, plutôt qu'en deux copies qui
 * finiraient par diverger sur le traitement d'une URL périmée.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { resignerPiecesJointes } from "./discord-rest.js";

/**
 * Médias lourds hors de Supabase Storage (quota gratuit : 1 Go, 5 Go d'egress).
 *
 * Avec `RG_MEDIA_ROOT` (`rg-core` sur le VPS : `/var/lib/rg-core/media`), les buckets PUBLICS
 * lourds s'écrivent sur disque sous `<racine>/<bucket>/<chemin>` et sont servis par nginx derrière
 * le cache Cloudflare de `cdn.rosegriffon.fr`, à la MÊME forme d'URL que Storage
 * (`/storage/v1/object/public/<bucket>/<chemin>`) : un lien existant reste valable quel que soit
 * l'hôte qui le sert. Les petits buckets privés (avatars, preuves ranked, patreon) restent sur Storage.
 */
const BUCKETS_MEDIAS_LOURDS = new Set(["tweets", "assets"]);

/** Racine disque des médias lourds, ou `null` (écriture vers Supabase Storage). */
export function racineMedias(): string | null {
  return Bun.env.RG_MEDIA_ROOT?.trim() || null;
}

/** Fichier disque d'un objet de média lourd, ou `null` s'il vit dans Storage. */
export function fichierMedia(bucket: string, chemin: string): string | null {
  const racine = racineMedias();
  if (!racine || !BUCKETS_MEDIAS_LOURDS.has(bucket)) return null;
  const dossier = join(racine, bucket);
  const fichier = normalize(join(dossier, chemin));
  if (!fichier.startsWith(dossier + sep)) throw new Error(`Chemin d'objet hors du bucket : ${chemin}`);
  return fichier;
}

/**
 * URL publique d'un objet : l'origine des médias (`RG_MEDIA_PUBLIC_ORIGIN`, `cdn.rosegriffon.fr`)
 * quand il vit sur disque, sinon `origineStorage` (l'origine qui relaie Supabase Storage).
 */
export function urlPubliqueObjet(bucket: string, chemin: string, origineStorage: string): string {
  const origine = fichierMedia(bucket, chemin)
    ? (Bun.env.RG_MEDIA_PUBLIC_ORIGIN ?? "https://cdn.rosegriffon.fr")
    : origineStorage;
  return `${origine.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${chemin}`;
}

/**
 * Base du service Storage : le projet Supabase (`/storage/v1`).
 *
 * `SUPABASE_INTERNAL_URL` garde la priorité pour viser une autre instance ; à
 * défaut, l'URL du projet Supabase. Aucun repli sur une boucle locale : une
 * fonction serverless n'a pas de service Storage sur sa machine.
 */
export function baseStorage(): string {
  const brut = Bun.env.SUPABASE_INTERNAL_URL || Bun.env.SUPABASE_URL || Bun.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!brut) throw new Error("SUPABASE_URL (ou SUPABASE_INTERNAL_URL) n'est pas configurée.");
  return brut.replace(/\/+$/, "");
}

/** Résultat d'un téléchargement : les octets, ou le motif de l'échec. */
export type TelechargementDiscord =
  { ok: true; octets: ArrayBuffer; typeMime: string; urlUtilisee: string } | { ok: false; motif: string };

/**
 * Télécharge une pièce jointe Discord, en re-signant son URL si elle a expiré.
 *
 * Sur 403/404 l'URL signée est simplement périmée : Discord sait la re-signer
 * (`POST /channels/{id}/attachments/refresh-urls`), on retente UNE fois avant
 * d'abandonner. `tailleMax` protège la mémoire du démon comme le bucket.
 */
export async function telechargerPieceJointeDiscord(
  salonId: string,
  url: string,
  tailleMax: number,
  typeMimeAttendu?: string | null,
  /**
   * Familles de types MIME acceptées, en préfixe.
   *
   * Défaut `image/` : c'est ce qu'attendent les visuels de sondage et tous les
   * appelants historiques. `campagnes-discord.ts` y ajoute `video/` — une
   * participation à une campagne peut être une vidéo, et la refuser ici la
   * faisait disparaître sans qu'aucun compteur ne bouge.
   */
  prefixesAutorises: readonly string[] = ["image/"],
): Promise<TelechargementDiscord> {
  let urlUtilisee = url;
  let reponse = await fetch(urlUtilisee).catch(() => null);

  if (!reponse || reponse.status === 403 || reponse.status === 404) {
    const fraiches = await resignerPiecesJointes(salonId, [urlUtilisee]);
    const fraiche = fraiches?.[0];
    if (!fraiche) return { ok: false, motif: "URL Discord périmée et non re-signable" };
    urlUtilisee = fraiche;
    reponse = await fetch(urlUtilisee).catch(() => null);
  }

  if (!reponse?.ok) {
    return { ok: false, motif: `téléchargement Discord ${reponse?.status ?? "injoignable"}` };
  }

  const typeMime = reponse.headers.get("content-type") ?? typeMimeAttendu ?? "";
  if (!prefixesAutorises.some(prefixe => typeMime.startsWith(prefixe))) {
    return {
      ok: false,
      motif: `type refusé (${typeMime || "inconnu"} ; attendu ${prefixesAutorises.join(" ou ")})`,
    };
  }

  const octets = await reponse.arrayBuffer();
  if (octets.byteLength > tailleMax) {
    return { ok: false, motif: `fichier trop lourd (${octets.byteLength} o)` };
  }

  return { ok: true, octets, typeMime, urlUtilisee };
}

/**
 * Écrit un objet dans un bucket de Supabase Storage, ou sur le disque des médias lourds (`RG_MEDIA_ROOT`).
 *
 * `x-upsert: true` rend l'opération rejouable à l'infini sur un chemin
 * déterministe : une seconde passe réécrit le même octet au même endroit plutôt
 * que de créer un doublon horodaté.
 */
export async function televerserObjet(
  bucket: string,
  chemin: string,
  octets: ArrayBuffer,
  typeMime: string,
): Promise<{ ok: boolean; motif?: string }> {
  const fichier = fichierMedia(bucket, chemin);
  if (fichier) {
    try {
      await mkdir(dirname(fichier), { recursive: true });
      await Bun.write(fichier, octets);
      return { ok: true };
    } catch (err) {
      return { ok: false, motif: `écriture disque ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const cle = Bun.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cle) return { ok: false, motif: "SUPABASE_SERVICE_ROLE_KEY absente" };
  let base: string;
  try {
    base = baseStorage();
  } catch (err) {
    return { ok: false, motif: err instanceof Error ? err.message : String(err) };
  }

  const envoi = await fetch(`${base}/storage/v1/object/${bucket}/${chemin}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cle}`,
      apikey: cle,
      "content-type": typeMime,
      "x-upsert": "true",
    },
    body: octets,
  }).catch(() => null);

  if (!envoi?.ok) {
    const texte = await envoi?.text().catch(() => "");
    return {
      ok: false,
      motif: `Storage ${envoi?.status ?? "injoignable"} ${(texte ?? "").slice(0, 120)}`,
    };
  }
  return { ok: true };
}

/**
 * URL d'origine DÉBARRASSÉE de sa signature.
 *
 * Conservée comme trace de provenance (« ce fichier vient bien de ce message »),
 * jamais servie au navigateur : `ex`/`is`/`hm` sont des jetons temporaires, les
 * garder en base donnerait l'illusion d'un lien utilisable.
 */
export function urlSansSignature(url: string): string {
  try {
    const analysee = new URL(url);
    analysee.search = "";
    return analysee.toString();
  } catch {
    return url;
  }
}
