import "server-only";

/**
 * Japonais — lexique du domaine, construit depuis le wiki.
 *
 * Le vocabulaire de fiction (ベジータ, サイヤ人, ナメック星) n'est dans aucun
 * dictionnaire japonais : c'est le nôtre, et il est déjà en base — colonnes
 * `name_ja` / `title_ja` du schéma `bot`. C'est ce qui permet de distinguer
 * « graphie inconnue parce que c'est du Dragon Ball » de « graphie inconnue
 * parce que le modèle a mal lu ».
 *
 * `name_ja` n'est PAS un champ propre : il empile les variantes et leur romaji
 * dans une seule cellule, séparés par des virgules — par exemple
 * « ザマスの意思, Zamasu no Ishi, 無限ザマス, Mugen Zamasu ». On éclate, et on ne
 * retient que les fragments qui contiennent réellement du japonais.
 *
 * Couverture mesurée le 2026-08-22 : 763 termes exploitables. Les techniques y
 * manquent entièrement (aucune n'a de `name_ja` renseigné), d'où l'absence de
 * かめはめ波 et de 界王拳 — c'est la première lacune à combler.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contientJaponais } from "./normalisation";
import { indexerLexique, trierLexique, type IndexLexique, type TermeLexique } from "./anomalies";

/** Un terme d'un seul signe apparie partout et ne prouve rien. */
const LONGUEUR_MIN = 2;

let cache: { at: number; termes: TermeLexique[]; index: IndexLexique } | null = null;
const TTL_MS = 10 * 60_000;

/**
 * Lexique japonais → français, trié du plus long au plus court.
 *
 * L'ordre est significatif : à l'appariement, « サイヤ人 » doit être reconnu
 * avant que « サイヤ » ne morde dessus.
 */
export async function lexiqueDomaine(): Promise<TermeLexique[]> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.termes;

	const lignes = await db.execute<{ ja: string; fr: string; kind: string }>(sql`
		SELECT name_ja AS ja, name AS fr, 'personnage' AS kind FROM bot.db_characters WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'planete'   FROM bot.db_planets     WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'race'      FROM bot.db_races       WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'saga'      FROM bot.db_sagas       WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'arc'       FROM bot.db_arcs        WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'technique' FROM bot.db_techniques  WHERE name_ja IS NOT NULL
	`);

	const vus = new Set<string>();
	const termes: TermeLexique[] = [];
	for (const l of lignes) {
		for (const variante of String(l.ja).split(/[,、;]/)) {
			const ja = variante
				.trim()
				.replace(/^[（(]+|[）)]+$/g, "")
				.trim();
			if (ja.length < LONGUEUR_MIN || !contientJaponais(ja) || vus.has(ja)) continue;
			vus.add(ja);
			// Le libellé français porte parfois une désambiguïsation entre
			// parenthèses (« Piccolo (futur) ») : utile en base, parasite dès qu'on
			// réinjecte le terme dans une phrase traduite.
			const fr = String(l.fr ?? "")
				.replace(/\s*\([^)]*\)\s*$/, "")
				.trim();
			termes.push({ ja, fr, kind: l.kind });
		}
	}

	const tries = trierLexique(termes);
	// L'index est bâti ICI, avec le lexique, et pas à chaque analyse : il énumère
	// toutes les sous-chaînes des 763 termes. Le reconstruire par planche revenait
	// à le refaire 362 fois pour un seul ouvrage.
	cache = { at: Date.now(), termes: tries, index: indexerLexique(tries) };
	return tries;
}

/** Index d'appartenance du lexique, construit une fois avec lui. */
export async function indexLexiqueDomaine(): Promise<IndexLexique> {
	await lexiqueDomaine();
	return cache!.index;
}

/** Vide le cache — à appeler après une édition du wiki qui touche `name_ja`. */
function oublierLexique(): void {
	cache = null;
}
