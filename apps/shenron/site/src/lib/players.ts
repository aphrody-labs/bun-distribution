/**
 * Ordre de présélection des lecteurs vidéo (client-safe).
 *
 * Un épisode ou un film porte plusieurs lecteurs tiers, et l'interface ouvre le
 * PREMIER du tableau. Cet ordre venait tel quel de l'ingest voir-anime : rien ne
 * garantissait que le lecteur ouvert par défaut soit celui qui fonctionne.
 *
 * Constat du 2026-08 (cf. purge `prune-dead-embed-players.ts`) : sur sept
 * hébergeurs historiques, six sont morts ou inaccessibles — streamhide (domaine
 * éteint), filemoon (changement de plateforme), voe et streamtape (bloqués),
 * mail.ru et yourupload (link rot partiel). Seul **vidmoly** répond de façon
 * fiable. L'ordre observé en base le place aujourd'hui en tête sur les 826
 * épisodes et les 22 films — mais par hasard, pas par construction : un
 * ré-import remettrait un hébergeur mort en première position sans que rien ne
 * le signale, et le visiteur tomberait sur un lecteur vide.
 *
 * Ce tri rend la règle explicite. Il est stable : à fiabilité égale, l'ordre
 * d'origine est conservé (VF avant VOSTFR tel qu'importé, notamment).
 */

/** Du plus fiable au moins fiable. Un hébergeur inconnu passe après les connus. */
const FIABILITE: readonly string[] = ["vidmoly", "mailru", "yourupload"];

/** Hébergeurs constatés morts : relégués en fin de liste, jamais présélectionnés. */
const MORTS = new Set(["streamhide", "filemoon", "voe", "streamtape", "doodstream"]);

function rang(provider: string | undefined): number {
	const p = (provider ?? "").toLowerCase();
	if (MORTS.has(p)) return 900;
	const i = FIABILITE.indexOf(p);
	return i === -1 ? 500 : i;
}

/**
 * Trie une liste de lecteurs par fiabilité décroissante, en préservant l'ordre
 * relatif d'origine à fiabilité égale.
 */
export function orderPlayers<T extends { provider: string }>(
	players: readonly T[] | null | undefined
): T[] | null {
	// `players` est un jsonb : il a déjà été un scalaire corrompu par le passé
	// (cf. piège `sql.json` dans CLAUDE.md). On ne fait confiance à rien.
	if (!Array.isArray(players)) return null;
	return players
		.map((p, i) => ({ p, i, r: rang(p?.provider) }))
		.toSorted((a, b) => a.r - b.r || a.i - b.i)
		.map((x) => x.p);
}
