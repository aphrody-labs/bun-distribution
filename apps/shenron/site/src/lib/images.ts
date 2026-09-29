/**
 * Politique d'optimisation des images (client-safe).
 *
 * Le site servait **toutes** ses images en JPEG brut : `unoptimized: true` était
 * posé globalement dans `next.config.ts`. La raison était réelle — sur Vercel,
 * l'optimiseur figeait une image par URL source, si bien qu'un remplacement
 * depuis l'admin du wiki n'apparaissait jamais. Mais elle ne vaut plus : le site
 * est auto-hébergé depuis le 2026-06-12, et l'optimiseur local respecte le
 * `Cache-Control` de la source.
 *
 * Le coût de ce choix était lourd : une vignette d'épisode de 780×585 pèse
 * ~60 Kio en JPEG et ~15 Kio en AVIF à la largeur réellement rendue — **−73 %**
 * mesuré sur un échantillon. Une page de liste en affiche jusqu'à 85.
 *
 * On ne rétablit donc pas le problème d'origine : les seules images vraiment
 * modifiables en place sont les téléversements de l'admin (`assets/wiki/**`,
 * cf. `lib/assets.ts`). Celles-là restent NON optimisées, donc immédiatement
 * fraîches après un remplacement. Tout le reste — imports figés (`assets/ext/**`)
 * et médias immuables du bot (`/db/**`, `Cache-Control: immutable`) — passe par
 * l'optimiseur.
 */

/** Préfixe des images téléversées depuis l'admin, remplaçables au même chemin. */
const PREFIXE_EDITABLE = "assets/wiki/";

/**
 * L'image peut-elle être remplacée en place depuis l'admin ?
 *
 * Accepte aussi bien un chemin DB (`assets/wiki/x.png`, `./assets/wiki/x.png`)
 * qu'une URL absolue servie par le bot.
 */
export function isEditableAsset(src: string | null | undefined): boolean {
	if (!src) return false;
	return src.includes(PREFIXE_EDITABLE);
}

/**
 * Largeurs acceptées par l'optimiseur — miroir de `images.{imageSizes,deviceSizes}`
 * dans `next.config.ts`. Une largeur absente de ces listes est REFUSÉE (400) :
 * l'allow-list est ce qui empêche un tiers de faire recalculer l'image à toutes
 * les tailles imaginables.
 */
export const LARGEURS_OPTIMISEUR = [
	64, 96, 128, 192, 256, 384, 640, 828, 1080, 1200, 1920,
] as const;

/**
 * URL d'une image passée par l'optimiseur, pour les cas où `next/image` ne peut
 * pas être utilisé — typiquement une image en hauteur intrinsèque (`h-auto`),
 * dont on ne connaît pas les dimensions et qui ne supporte donc ni `fill` ni
 * `width`/`height`.
 *
 * C'est le cas du lecteur de databooks : une planche s'affiche dans 768 px de
 * large mais chargeait le scan source, jusqu'à 5 Mio.
 *
 * Un téléversement de l'admin est renvoyé tel quel — il doit rester frais dès
 * son remplacement (cf. `isEditableAsset`).
 */
export function optimizedSrc(src: string, width: number, quality = 70): string {
	if (isEditableAsset(src)) return src;
	const w = LARGEURS_OPTIMISEUR.find((c) => c >= width) ?? LARGEURS_OPTIMISEUR.at(-1)!;
	return `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${quality}`;
}

/** `srcSet` sur plusieurs largeurs, pour laisser le navigateur choisir. */
export function optimizedSrcSet(src: string, largeurs: readonly number[], quality = 70): string {
	if (isEditableAsset(src)) return "";
	return largeurs
		.map((l) => `${optimizedSrc(src, l, quality)} ${LARGEURS_OPTIMISEUR.find((c) => c >= l) ?? l}w`)
		.join(", ");
}
