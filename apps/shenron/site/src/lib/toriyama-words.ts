/**
 * toriyama-words — **un seul endroit** pour tout ce qu'Akira Toriyama a dit.
 *
 * Ses déclarations étaient dispersées : des citations dans le corpus canon
 * (`canon_references`, alimenté par l'ingest des databooks et la curation
 * manuelle), des interviews rangées parmi les 451 ouvrages de `/wiki/databooks`,
 * des introductions de tankōbon dans un troisième jeu de documents. Résultat :
 * personne, lecteur comme rédacteur, ne pouvait répondre à « qu'a-t-il dit sur
 * Vegeta ? » sans ouvrir trois écrans et recouper à la main.
 *
 * Ce module rassemble les trois sources en une liste, groupée par ouvrage, et ne
 * garde QUE ce qui est attribuable à l'auteur — pas le commentaire éditorial
 * d'un guide, pas une synthèse de rédaction. La règle de tri est explicite
 * (`isAuthorVoice`) plutôt que devinée, parce que c'est elle qui fait la
 * différence entre « Toriyama a dit » et « un guide affirme ».
 *
 * Rien n'est inventé ni reformulé : le texte est celui de la source, la
 * traduction celle du corpus, et la référence accompagne chaque citation comme
 * dans le Daijiten — « (大全集3・P122) » — parce que c'est ce qui la rend
 * vérifiable.
 *
 * Server-only.
 */
import "server-only";
import { getCanonReferences } from "@/lib/canon-config";
import { listDatabooks, type DatabookRecord } from "@/lib/databooks";
import {
	prettyDocument,
	resolveToriyamaHref,
	type ToriyamaWord,
	type ToriyamaSourceGroup,
} from "@/lib/toriyama-shared";

export { prettyDocument,  type ToriyamaWord, type ToriyamaSourceGroup };

export type ToriyamaCorpusScope = "all" | "interviews" | "profile";

/** Un ouvrage explicitement catalogué comme interview de Toriyama. */
export function isToriyamaInterviewBook(book: Pick<DatabookRecord, "kind" | "title" | "author" | "description">): boolean {
	const title = (book.title ?? "").toLowerCase();
	const author = (book.author ?? "").toLowerCase();
	const all = `${title} ${author} ${book.description ?? ""}`.toLowerCase();
	if (EXCLUDED_MARKERS.some((m) => all.includes(m))) return false;
	if (book.kind === "interview") return true;
	return (
		/toriyama|鳥山明/.test(all) &&
		/interview|entretien|ask akira|q\s*&\s*a|wired japan/.test(all)
	);
}

/**
 * Classement éditorial fondé sur la provenance canonique, jamais sur le seul
 * mot « Toriyama ». Les résultats RAG/canon peuvent nommer un ouvrage comme
 * source ; cette règle conserve alors l'entretien dans sa page documentaire,
 * tandis que les introductions et commentaires d'auteur restent sur la page
 * biographique de Toriyama.
 */
function isInterviewDocument(ref: { source: string; document: string }, book: DatabookRecord | null): boolean {
	if (book && isToriyamaInterviewBook(book)) return true;
	const haystack = `${ref.source} ${ref.document}`.toLowerCase();
	return /interview|entretien|super interview|shenlong times|wired japan|q\s*&\s*a|dragon ball forever/.test(haystack);
}

/**
 * Indices d'une parole d'auteur, par ordre de fiabilité décroissante.
 *
 * `interview` et `entretien` sont les plus sûrs ; les introductions de tankōbon
 * et le *Hetappi Manga Kenkyūjo* (son manuel de dessin, écrit à la première
 * personne) le sont aussi. `Shenlong Times` est la lettre d'auteur encartée dans
 * les Daizenshuu. On exclut en revanche les guides d'animation et les fiches de
 * personnage : ce sont des textes de rédaction, même quand ils le citent.
 */
const AUTHOR_DOCUMENTS = new Set([
	"akira toriyama hetappi manga kenkyūjo",
	"toriyama_akira-toriyama-tankobon-introductions.md",
	"interview d'akira toriyama — daizenshuu 1 (version intégrale)",
	"interview d'akira toriyama — daizenshuu 2",
	"entretien toriyama × toyotarō — dragon ball super",
	"wired japan 1997 #1: “issue 3.01”",
	"saikyō jump (2014 & 2018) — entretiens d'akira toriyama",
]);

const AUTHOR_VOICE_MARKERS = [
	"interview",
	"entretien",
	"super interview",
	"shenlong times",
	"q&a",
	"mot de l'auteur",
	"commentaire de l'auteur",
	"parole d'auteur",
	"shinjitsu",
	"la vérité sur",
	"me these days",
	"ce que je deviens ces jours-ci",
	"rétrospective d'akira toriyama",
	"révélations canoniques d'akira toriyama",
	"hetappi",
	"tankobon",
	"tankōbon",
];

const EXCLUDED_MARKERS = [
	"special anime",
	"the world special",
	"carddass",
	"perfect file",
	"shin budokai",
	"flying postman",
];

/** La référence est-elle une parole de l'auteur, et non du commentaire éditorial ? */
export function isAuthorVoice(ref: { source: string; document: string; subject: string }): boolean {
	const doc = (ref.document ?? "").toLowerCase().trim();
	const sourceAndSubject = `${ref.source} ${ref.subject}`.toLowerCase();
	const all = `${ref.source} ${ref.document} ${ref.subject}`.toLowerCase();

	if (EXCLUDED_MARKERS.some((m) => all.includes(m))) {
		return false;
	}

	// 1. Ouvrages dont 100% des entrées sont des paroles de l'auteur
	if (AUTHOR_DOCUMENTS.has(doc)) {
		return true;
	}

	// 2. Extraits d'interviews, de lettres ou de Q&A identifiés dans la source ou le sujet
	return AUTHOR_VOICE_MARKERS.some((m) => sourceAndSubject.includes(m));
}

/** Normalise un titre d'ouvrage pour l'apparier au catalogue des databooks. */
function normalizeTitle(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * Toutes les paroles d'auteur, groupées par ouvrage et triées du plus ancien au
 * plus récent (un corpus chronologique se lit ; un corpus alphabétique se
 * consulte, et personne ne consulte un auteur).
 *
 * Ne lève jamais : une source indisponible réduit la liste, elle ne casse pas la
 * page.
 */
export async function listToriyamaWords(): Promise<{
	groups: ToriyamaSourceGroup[];
	total: number;
	documents: number;
	translated: number;
}>;
export async function listToriyamaWords(scope?: ToriyamaCorpusScope): Promise<{
	groups: ToriyamaSourceGroup[];
	total: number;
	documents: number;
	translated: number;
}>;
export async function listToriyamaWords(scope: ToriyamaCorpusScope = "all"): Promise<{
	groups: ToriyamaSourceGroup[];
	total: number;
	documents: number;
	translated: number;
}> {
	const [refs, page] = await Promise.all([
		getCanonReferences().catch(() => []),
		// `DATABOOK_LIMIT_MAX` borne la page à 200 : le catalogue en compte 451, on
		// pagine donc, sans quoi les ouvrages au-delà du 200e n'auraient jamais de
		// lien vers leur planche.
		listDatabooks({ limit: 200 }).catch(() => ({ items: [] as DatabookRecord[], total: 0 })),
	]);
	const catalogue: DatabookRecord[] = [...page.items];
	for (let offset = catalogue.length; offset < page.total; offset += 200) {
		const next = await listDatabooks({ limit: 200, offset }).catch(() => ({
			items: [] as DatabookRecord[],
		}));
		if (next.items.length === 0) break;
		catalogue.push(...next.items);
	}

	// Index du catalogue par titre normalisé : il porte les interviews et les
	// artbooks, donc le lien vers la planche quand elle est en ligne.
	const byTitle = new Map<string, DatabookRecord>();
	for (const book of catalogue) {
		if (!book.visible) continue;
		byTitle.set(normalizeTitle(book.title), book);
		if (book.title_ja) byTitle.set(normalizeTitle(book.title_ja), book);
	}

	const words: ToriyamaWord[] = [];
	for (const ref of refs) {
		if (!isAuthorVoice(ref)) continue;
		const book = byTitle.get(normalizeTitle(ref.document));
		const interviewDocument = isInterviewDocument(ref, book ?? null);
		if (scope === "interviews" && !interviewDocument) continue;
		if (scope === "profile" && interviewDocument) continue;
		words.push({
			id: ref.id,
			subject: ref.subject,
			text: ref.text,
			textFr: ref.textFr ?? null,
			lang: ref.lang,
			source: ref.source,
			year: ref.year ?? null,
			document: ref.document,
			// Les imports historiques utilisaient `/wiki/canon` comme lien de
			// repli. Dès qu'un ouvrage du catalogue est identifié, la citation
			// doit ouvrir sa source primaire : la page canon reste accessible
			// depuis la navigation, mais ne remplace pas le document cité.
			href: resolveToriyamaHref(ref.href, book?.id),
		});
	}

	// Les interviews du catalogue qui n'ont produit aucune citation méritent quand
	// même d'être citées si l'ouvrage est bien de l'auteur : l'ouvrage existe, ses planches sont lisibles.
	const interviews = catalogue.filter(
		(b) => b.visible && isToriyamaInterviewBook(b)
	);

	const groups = new Map<string, ToriyamaSourceGroup>();
	const ensure = (document: string, year: number | null, book: DatabookRecord | null) => {
		const bookYear = book?.published_at
			? new Date(book.published_at * 1000).getUTCFullYear()
			: null;
		const resolvedYear = year ?? bookYear;
		const existing = groups.get(document);
		if (existing) {
			if (existing.year === null && resolvedYear !== null) existing.year = resolvedYear;
			if (existing.databookId === null && book?.id) existing.databookId = book.id;
			if (existing.cover === null && book?.cover) existing.cover = book.cover;
			return existing;
		}
		const created: ToriyamaSourceGroup = {
			document: prettyDocument(document),
			documentKey: document,
			year: resolvedYear,
			databookId: book?.id ?? null,
			kind: book?.kind ?? null,
			cover: book?.cover ?? null,
			words: [],
		};
		groups.set(document, created);
		return created;
	};

	for (const w of words) {
		const book = byTitle.get(normalizeTitle(w.document)) ?? null;
		ensure(w.document, w.year, book).words.push(w);
	}
	for (const book of scope === "profile" ? [] : interviews) {
		// `published_at` est en secondes (cf. `lib/databooks`).
		const year = book.published_at ? new Date(book.published_at * 1000).getUTCFullYear() : null;
		ensure(book.title, year, book);
	}

	const ordered = [...groups.values()].toSorted((a, b) => {
		// Sans année connue, l'ouvrage passe en fin de liste plutôt qu'en tête :
		// une date manquante n'est pas une date ancienne.
		if (a.year === null && b.year === null) return a.document.localeCompare(b.document, "fr");
		if (a.year === null) return 1;
		if (b.year === null) return -1;
		return a.year - b.year;
	});
	for (const g of ordered) {
		g.words.sort((a, b) => a.subject.localeCompare(b.subject, "fr"));
	}

	return {
		groups: ordered,
		total: words.length,
		documents: ordered.length,
		translated: words.filter((w) => w.textFr !== null || w.lang === "fr").length,
	};
}

/** A reading path through the corpus: a subject and the words that match it. */
export interface ToriyamaTheme {
	id: string;
	title: string;
	/** Why this theme exists, one sentence, no interpretation of the quotes. */
	lede: string;
	words: ToriyamaWord[];
}

/**
 * Themes are selected by matching, never by rewriting: a quote lands under
 * « Vegeta » because it names him, not because an editor thinks it is about him.
 */
const THEMES: ReadonlyArray<{ id: string; title: string; lede: string; pattern: RegExp }> = [
	{
		id: "goku",
		title: "Son Goku",
		lede: "Le héros qu'il a dessiné pendant dix ans et demi.",
		pattern: /\bgoku\b|悟空/i,
	},
	{
		id: "vegeta",
		title: "Vegeta",
		lede: "Le rival que les lecteurs lui ont imposé.",
		pattern: /\bvegeta\b|ベジータ/i,
	},
	{
		id: "piccolo",
		title: "Piccolo",
		lede: "Le personnage qu'il dit préférer.",
		pattern: /\bpiccolo\b|ピッコロ/i,
	},
	{
		id: "gohan",
		title: "Son Gohan",
		lede: "Le successeur qui n'a pas pris la place.",
		pattern: /\bgohan\b|悟飯/i,
	},
	{
		id: "ennemis",
		title: "Freezer, Cell et Boo",
		lede: "Les trois adversaires qui structurent la seconde moitié du manga.",
		pattern: /\bfreez[ae]r?\b|\bfrieza\b|\bcell\b|\bb[ou]{2}\b|フリーザ|セル|ブウ/i,
	},
	{
		id: "super-saiyan",
		title: "Super Saiyan et transformations",
		lede: "Les cheveux blonds, l'aura, les paliers.",
		pattern: /super saiya|超サイヤ|\bblond|cheveux|\bhair\b|transformation/i,
	},
	{
		id: "atelier",
		title: "L'atelier et la méthode",
		lede: "Le rythme hebdomadaire, l'encre, l'éditeur, les délais.",
		pattern:
			/\bdessin|\bdraw|\bencre\b|\bink\b|assistant|torishima|\béditeur|\beditor\b|\bd[ée]lai|deadline|hebdo|weekly|原稿|締め切り|アシスタント|編集/i,
	},
];

const THEME_MAX_WORDS = 3;
const THEME_MAX_CHARS = 700;

/**
 * Up to three words per theme, one per work, the readable ones first: a
 * translated quote before an untranslated one, a short one before a long one.
 * A theme with no match is dropped, not padded.
 */
export function pickThemes(words: ToriyamaWord[]): ToriyamaTheme[] {
	const readable = (w: ToriyamaWord) =>
		(w.lang === "fr" || w.textFr !== null ? 0 : 1) * 10_000 + (w.textFr ?? w.text).length;
	const themes: ToriyamaTheme[] = [];
	for (const theme of THEMES) {
		const matched = words
			.filter((w) => {
				const haystack = `${w.subject} ${w.text} ${w.textFr ?? ""}`;
				return theme.pattern.test(haystack) && (w.textFr ?? w.text).length <= THEME_MAX_CHARS;
			})
			.toSorted((a, b) => readable(a) - readable(b));
		const picked: ToriyamaWord[] = [];
		const seenDocuments = new Set<string>();
		for (const w of matched) {
			if (seenDocuments.has(w.document)) continue;
			seenDocuments.add(w.document);
			picked.push(w);
			if (picked.length === THEME_MAX_WORDS) break;
		}
		if (picked.length > 0)
			themes.push({ id: theme.id, title: theme.title, lede: theme.lede, words: picked });
	}
	return themes;
}
