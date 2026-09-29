/**
 * Plafond de prérendu des grandes collections.
 *
 * `generateStaticParams` est indispensable pour que Next 16 cache une route à
 * segment dynamique (sans lui, la page est rendue à la volée en `no-store`).
 * Mais rien n'oblige à y déclarer TOUTES les entités : `dynamicParams` reste à
 * `true`, donc une entité absente de la liste est rendue à la première demande
 * puis mise en cache ISR exactement comme les autres.
 *
 * Le plafond n'est pas cosmétique. Après la republication des 2 309 fiches
 * masquées (2026-08-21), le prérendu exhaustif passait de ~1 540 à ~3 700 pages,
 * sur un VPS où `next build` réclame déjà ~10,5 Gio de mémoire anonyme pour
 * 11 Gio de RAM — le build a été tué par l'OOM killer. Prérendre 1 323 fiches
 * de personnage au build pour un site à faible trafic, c'est payer cher un cache
 * que l'ISR remplit gratuitement à la demande.
 *
 * Les petites collections (films, sagas, races, jeux…) ne sont pas plafonnées :
 * quelques dizaines de pages ne coûtent rien.
 */

/** Nombre d'entités prérendues au build pour une grande collection. */
const PRERENDER_CAP = 40;

/**
 * Tronque une liste de paramètres au plafond. Le reste est rendu à la demande.
 * Passer `cap: 0` désactive le prérendu (jamais souhaitable : cf. en-tête).
 */
export function capParams<T>(list: readonly T[], cap: number = PRERENDER_CAP): T[] {
	return list.length <= cap ? [...list] : list.slice(0, cap);
}
