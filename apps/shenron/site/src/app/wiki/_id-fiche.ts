/**
 * Identifiant de fiche accepté par les routes `/wiki/<rubrique>/[id]`.
 *
 * Le garde a été écrit pour `/wiki/personnages/[id]` puis laissé là, alors que
 * six autres routes numériques du wiki avaient exactement le même défaut. Il
 * vit donc ici, partagé, plutôt qu'en copie locale.
 *
 * Ce qu'il empêche :
 *
 *  - **Les doublons d'URL.** `parseInt` acceptait tout ce qui COMMENÇAIT par un
 *    chiffre : `/wiki/episodes/007` et `/wiki/episodes/1-goku` servaient les
 *    fiches 7 et 1 en se déclarant canoniques à LEUR propre URL. Autant de
 *    variantes indexables d'une même fiche, produites à volonté depuis
 *    l'extérieur. `Number` était à peine mieux : il accepte encore `007`,
 *    `0x10`, `1e3` et les espaces autour.
 *  - **Les requêtes inutiles.** Une URL sans chiffre partait quand même en base
 *    (`NaN`), provoquait une erreur Postgres rattrapée par l'accesseur, et
 *    finissait en 404 — un aller-retour pour rien à chaque robot égaré.
 *
 * Seule l'écriture canonique en base 10 passe : celle que produit
 * `String(row.id)`, donc celle des liens du site et de `generateStaticParams`.
 */
export function idDeFiche(brut: string): number | null {
	if (!/^(0|[1-9][0-9]*)$/.test(brut)) return null;
	const n = Number(brut);
	return Number.isSafeInteger(n) ? n : null;
}
