import "server-only";

import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import { and, eq, isNotNull, lte, type SQL } from "drizzle-orm";
import { buildExtensions } from "@/components/editor/schema";
import { slugify } from "@/lib/slug";
import { posts, type PostContentDoc } from "@/db/schema";

/**
 * Rendu et analyse du contenu des articles — **server-only**.
 *
 * Le HTML public est TOUJOURS régénéré ici depuis le JSON Tiptap, jamais repris
 * du navigateur : le formulaire d'admin envoie le document, pas du balisage. Un
 * client compromis ne peut donc pas injecter de HTML arbitraire dans une page
 * publique — le rendu est borné au schéma du module d'édition
 * (`components/editor/schema.ts`), rigoureusement le même qu'à la saisie.
 *
 * `renderToHTMLString` sérialise le JSON ProseMirror sans instancier d'éditeur
 * ni de DOM : utilisable tel quel dans un Server Component / une Server Action.
 */

/**
 * Schéma de rendu des articles. **Identique** à celui de l'éditeur (même preset)
 * : une extension présente à la saisie mais absente ici ferait disparaître du
 * contenu déjà publié.
 */
const POST_EXTENSIONS = buildExtensions("article");

/**
 * Condition de visibilité publique d'un article — **règle unique du site**.
 *
 * Deux colonnes, deux rôles distincts :
 *   - `published` = l'article a été *validé* par la rédaction (il n'est plus un
 *     brouillon) ;
 *   - `publishedAt` = la date à laquelle il *entre en ligne*.
 *
 * Un article programmé est donc `published = true` avec une `publishedAt` dans
 * le futur : il sort tout seul quand l'heure est passée, à la première
 * revalidation ISR, sans tâche planifiée ni job de bascule à maintenir.
 *
 * ⚠️ C'est aussi le piège : filtrer sur `published` SEUL laisserait fuiter les
 * articles programmés avant l'heure. Tout accès public passe par cette fonction
 * — `/news`, la fiche article, la home, le sitemap et le flux RSS.
 */
export function publicPostFilter(): SQL | undefined {
	return and(
		eq(posts.published, true),
		isNotNull(posts.publishedAt),
		lte(posts.publishedAt, new Date())
	);
}

/** Une entrée du sommaire d'un article. */
export type PostHeading = { id: string; text: string; level: 2 | 3 | 4 };

export type RenderedPost = {
	html: string;
	text: string;
	headings: PostHeading[];
	wordCount: number;
	readingMinutes: number;
};

/** Vitesse de lecture retenue pour du français courant. */
const WORDS_PER_MINUTE = 220;

/** Concatène récursivement le texte d'un nœud Tiptap (et de ses descendants). */
function nodeText(node: unknown): string {
	if (!node || typeof node !== "object") return "";
	const n = node as { type?: string; text?: string; content?: unknown[] };
	if (typeof n.text === "string") return n.text;
	if (!Array.isArray(n.content)) return "";
	// Les nœuds de bloc sont séparés par une espace, sinon « ...finMot » colle au
	// mot suivant et fausse le comptage.
	const sep = n.type === "paragraph" || n.type === "heading" ? " " : "";
	return n.content.map(nodeText).join(sep);
}

/** Extrait le texte brut du document (recherche, extrait auto, temps de lecture). */
function docToPlainText(doc: PostContentDoc | null | undefined): string {
	if (!doc) return "";
	return nodeText(doc).replace(/\s+/g, " ").trim();
}

/**
 * Relève les titres de niveau 2 à 4 dans l'ordre du document et leur attribue un
 * ancrage unique (suffixe `-2`, `-3`… en cas de titres homonymes, fréquents du
 * type « Contexte »).
 */
function extractHeadings(doc: PostContentDoc | null | undefined): PostHeading[] {
	const out: PostHeading[] = [];
	const used = new Set<string>();
	if (!doc) return out;

	const walk = (node: unknown): void => {
		if (!node || typeof node !== "object") return;
		const n = node as { type?: string; attrs?: { level?: number }; content?: unknown[] };
		if (n.type === "heading") {
			const level = n.attrs?.level;
			if (level === 2 || level === 3 || level === 4) {
				const text = nodeText(n).replace(/\s+/g, " ").trim();
				if (text) {
					const base = slugify(text, 60) || `section-${out.length + 1}`;
					let id = base;
					for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
					used.add(id);
					out.push({ id, text, level });
				}
			}
		}
		if (Array.isArray(n.content)) n.content.forEach(walk);
	};

	walk(doc);
	return out;
}

/**
 * Injecte les ancres du sommaire dans le HTML rendu.
 *
 * Tiptap ne pose pas d'`id` sur les titres. On les ajoute après coup, en
 * consommant `headings` **dans l'ordre du document** : `extractHeadings` et
 * `renderToHTMLString` parcourent le même JSON dans le même ordre, donc la
 * n-ième balise `<hN>` du HTML correspond au n-ième titre relevé. Le motif
 * tolère les attributs déjà présents (`style="text-align: center"` posé par
 * l'extension TextAlign).
 */
function injectHeadingIds(html: string, headings: PostHeading[]): string {
	let i = 0;
	return html.replace(/<h([234])((?:\s[^>]*)?)>/g, (match, level: string, attrs: string) => {
		const heading = headings[i];
		// Sécurité : si le niveau ne correspond pas (schéma inattendu), on laisse la
		// balise intacte plutôt que de poser une ancre fausse qui casserait le sommaire.
		if (!heading || String(heading.level) !== level) return match;
		i++;
		return `<h${level}${attrs} id="${heading.id}">`;
	});
}

/** Mots + minutes de lecture (plancher à 1 min : « 0 min de lecture » n'a pas de sens). */
export function computeReadingStats(text: string): { wordCount: number; readingMinutes: number } {
	const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
	return { wordCount, readingMinutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)) };
}

/**
 * Rend un document Tiptap : HTML public, texte brut, sommaire et statistiques
 * de lecture, en un seul passage.
 */
export function renderPostDoc(doc: PostContentDoc | null | undefined): RenderedPost {
	const text = docToPlainText(doc);
	const stats = computeReadingStats(text);
	const headings = extractHeadings(doc);

	if (!doc) return { html: "", text, headings, ...stats };

	let html = "";
	try {
		html = renderToHTMLString({
			extensions: POST_EXTENSIONS,
			content: doc as never,
		});
	} catch {
		// Un document corrompu ne doit pas faire tomber toute la page article : on
		// dégrade sur le texte brut échappé plutôt que de renvoyer une 500.
		html = `<p>${escapeHtml(text)}</p>`;
		return { html, text, headings: [], ...stats };
	}

	return { html: injectHeadingIds(html, headings), text, headings, ...stats };
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Reconstitue le sommaire d'un article déjà rendu (colonne `contentHtml`), sans
 * repasser par le JSON. Sert aux articles publiés avant un éventuel changement
 * de schéma, et évite de re-sérialiser le document à chaque affichage.
 */
export function headingsFromHtml(html: string): PostHeading[] {
	const out: PostHeading[] = [];
	const re = /<h([234])(?:\s[^>]*?)?\sid="([^"]+)"(?:[^>]*)>([\s\S]*?)<\/h\1>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const text = m[3].replace(/<[^>]*>/g, "").trim();
		if (text) out.push({ id: m[2], text, level: Number(m[1]) as 2 | 3 | 4 });
	}
	return out;
}

/**
 * Résumé de repli quand l'admin n'a pas saisi d'extrait : première phrase(s) du
 * texte, coupée sur un mot entier.
 */
export function autoExcerpt(text: string, maxLength = 200): string {
	const clean = text.trim();
	if (clean.length <= maxLength) return clean;
	const cut = clean.slice(0, maxLength);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}
