/**
 * toriyama-shared — nommage des documents du corpus, **client-safe**.
 *
 * Séparé de `lib/toriyama-words.ts` (marqué `server-only` : il lit la base) pour
 * que la règle de nommage soit testable et réutilisable côté client. C'est une
 * fonction pure sur des chaînes, et elle a une conséquence de confidentialité :
 * c'est elle qui évite de publier les noms de fichiers et les chemins de
 * sauvegarde du corpus sur une page de lecture.
 */

/**
 * Titres lisibles pour les documents du corpus dont le nom est resté un nom de
 * FICHIER (`toriyama_toriyama-interviews.md`, `shenron_daizenshuu-1-shenlong-times_…_raw_guides.md`).
 *
 * Ce n'est pas cosmétique : afficher ces chaînes publierait l'arborescence
 * interne du corpus — chemins de sauvegarde, noms de lots d'ingestion — sur une
 * page de lecture. Et « toriyama_toriyama-interviews.md » ne dit pas à un lecteur
 * qu'il s'agit d'un recueil d'interviews.
 */
export interface ToriyamaWord {
	id: string;
	subject: string;
	text: string;
	textFr: string | null;
	lang: "fr" | "en" | "ja";
	source: string;
	year: number | null;
	document: string;
	href: string | null;
}

export interface ToriyamaSourceGroup {
	document: string;
	documentKey: string;
	year: number | null;
	databookId: number | null;
	kind: string | null;
	cover: string | null;
	words: ToriyamaWord[];
}

/** Source link for a citation once its catalogue document is known. */
export function resolveToriyamaHref(
	refHref: string | null | undefined,
	databookId: number | null | undefined
): string | null {
	if (databookId && (!refHref || refHref === "/wiki/canon")) {
		return `/wiki/databooks/${databookId}`;
	}
	return refHref ?? null;
}

const DOCUMENT_TITLES: Record<string, string> = {
	"toriyama_toriyama-interviews.md": "Interviews d'Akira Toriyama",
	"toriyama_akira-toriyama-tankobon-introductions.md":
		"Introductions des tomes, par Akira Toriyama",
	"toriyama_dragon-ball-forever-toriyama.md": "Dragon Ball Forever — entretien avec l'auteur",
	"toriyama_doctrine-artistique-akira-toriyama.md": "Doctrine artistique d'Akira Toriyama",
	"toriyama_toriyama-databook-seg.md": "Super Exciting Guide — Entretiens d'Akira Toriyama",
	"kanzenshuu-trad_chozenshu-4-akira-toriyama.md": "Chōzenshū 4 — Rétrospective Akira Toriyama",
	"saikyo-jump-2014-toriyama": "Saikyō Jump (2014 & 2018) — Entretiens d'Akira Toriyama",
};

/**
 * Libellé d'affichage d'un document : la table ci-dessus d'abord, puis un
 * nettoyage générique pour les lots à venir (extension, préfixe de corpus, queue
 * de chemin de sauvegarde, tirets).
 */
export function prettyDocument(raw: string): string {
	const known = DOCUMENT_TITLES[raw];
	if (known) return known;
	// Un titre d'ouvrage normal (« Dragon Ball Daizenshuu 7 — … ») n'est pas un
	// nom de fichier : on le rend tel quel.
	if (!/\.md$|_|\//.test(raw)) return raw;

	let out = raw.replace(/\.md$/i, "");
	// Queue ajoutée par l'ingestion : « …_shenron_data_backups_dbfr-20260906_apps_bot_data_rag_raw_guides ».
	out = out.replace(/_shenron_data_backups_.*$/i, "");
	out = out.replace(/^(toriyama|shenron|dbfr)_/i, "");
	out = out.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	if (!out) return raw;
	return out.charAt(0).toUpperCase() + out.slice(1);
}
