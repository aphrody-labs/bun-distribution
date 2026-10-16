import "server-only";

/**
 * TAILLE RÉELLE D'UNE IMAGE DISTANTE, LUE DANS SON EN-TÊTE.
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
 * Les visuels d'une campagne sont téléversés par l'équipe : leurs proportions
 * changent d'une campagne à l'autre et ne sont écrites nulle part. Les afficher
 * dans un cadre de proportions fixes (`AspectRatio`) revenait à border chaque
 * document de bandes vides — l'affiche IERG Day fait 1051 × 1447 (0,726) et la
 * carte des règles 1600 × 2197 (0,728), là où le cadre imposait 3/4 (0,75).
 *
 * Trois issues étaient possibles : écrire les tailles en dur (fausses dès la
 * campagne suivante), ajouter deux colonnes en base (à remplir à la main à
 * chaque téléversement, donc fausses un jour), ou LIRE le fichier. On lit le
 * fichier : c'est la seule source qui ne peut pas mentir.
 *
 * ── CE QU'ON NE TÉLÉCHARGE PAS ─────────────────────────────────────────────
 * Les dimensions vivent dans les tout premiers octets de chaque format. On
 * demande donc une PLAGE (`Range: bytes=0-<N>`) et non le fichier : 64 Kio au
 * lieu des 224 Kio de la carte des règles, et bien moins encore pour un PNG.
 * Le serveur qui ignore `Range` répond 200 avec tout le fichier — c'est
 * fonctionnellement correct, seulement moins économe, et `Response.bytes()`
 * n'en lit de toute façon que ce qu'il faut.
 *
 * ── MISE EN CACHE ──────────────────────────────────────────────────────────
 * `cache()` de React dédoublonne à l'échelle d'un rendu (la page demande les
 * mêmes visuels deux fois), et la carte de module tient entre les rendus du
 * même processus. La page `/iergday` est `force-dynamic` : sans elle, chaque
 * visite paierait deux requêtes HTTP de plus.
 */

import { cache } from "react";

import { lireDimensions, type DimensionsImage } from "./dimensions-shared";

export { lireDimensions, type DimensionsImage } from "./dimensions-shared";

/** Octets demandés : assez pour tous les en-têtes gérés, y compris un WebP étendu. */
const OCTETS_ENTETE = 64 * 1024;

/** Le sondage ne doit jamais retenir un rendu : au-delà, on rend la page sans. */
const DELAI_MS = 3000;

/**
 * Mémoire de processus. Les visuels d'une campagne ne changent pas d'une minute
 * à l'autre, et un `null` est mémorisé comme un succès : réessayer à chaque
 * rendu une URL qui ne répond pas coûterait le délai d'attente à chaque visite.
 */
const connues = new Map<string, DimensionsImage | null>();

/**
 * Dimensions d'une image distante, ou `null` si elles ne sont pas lisibles.
 *
 * ⚠ `null` N'EST PAS UNE ERREUR À REMONTER. L'appelant doit savoir se passer de
 * la mesure — un visuel dont on ignore les proportions s'affiche quand même,
 * simplement sans réservation de place exacte. Faire échouer la page parce
 * qu'une image n'a pas répondu serait hors de proportion.
 */
export const dimensionsImage = cache(async function dimensionsImage(
  url: string | null | undefined,
): Promise<DimensionsImage | null> {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
  if (connues.has(url)) return connues.get(url) ?? null;

  let mesure: DimensionsImage | null = null;
  try {
    const reponse = await fetch(url, {
      headers: { Range: `bytes=0-${OCTETS_ENTETE - 1}` },
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (reponse.ok || reponse.status === 206) {
      mesure = lireDimensions(new Uint8Array(await reponse.arrayBuffer()));
    }
  } catch {
    // Réseau coupé, délai dépassé, hôte injoignable : on retient `null` pour ne
    // pas repayer le délai d'attente à chaque rendu.
    mesure = null;
  }

  connues.set(url, mesure);
  return mesure;
});
