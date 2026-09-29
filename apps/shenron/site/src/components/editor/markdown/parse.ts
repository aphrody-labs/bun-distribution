/**
 * Lecture **markdown → document ProseMirror**.
 *
 * Chaîne : `marked` (markdown GFM, HTML brut laissé intact) → HTML → parseur de
 * schéma Tiptap. Le HTML écrit à la main dans le wiki traverse donc la chaîne
 * sans être réinterprété : les blocs connus (encadrés, colonnes, sections…)
 * retrouvent leur nœud, le reste atterrit dans les filets `htmlContainer` /
 * `htmlBlock` qui le conservent tel quel.
 *
 * `roundTripReport()` permet de vérifier AVANT toute écriture qu'ouvrir puis
 * réenregistrer une page ne la réécrit pas : c'est le garde-fou qui autorise
 * l'édition riche sur du contenu historique.
 */
import { generateJSON } from "@tiptap/html";
import { Marked } from "marked";
import type { Extensions, JSONContent } from "@tiptap/core";

import { serializeMarkdown } from "./serialize";

/**
 * `breaks: true` reproduit `remark-breaks` (actif au rendu public) : un simple
 * retour à la ligne est un `<br>`. `gfm: true` = tableaux, barré, autoliens.
 */
const marked = new Marked({ gfm: true, breaks: true, async: false });

/** Markdown (+ HTML libre) → HTML. */
export function markdownToHtml(source: string): string {
	return marked.parse(source ?? "", { async: false }) as string;
}

/** Markdown (+ HTML libre) → document Tiptap. */
export function parseMarkdown(source: string, extensions: Extensions): JSONContent {
	const html = markdownToHtml(source);
	if (!html.trim()) return { type: "doc", content: [{ type: "paragraph" }] };
	return generateJSON(html, extensions) as JSONContent;
}

/**
 * La fidélité se mesure sur **ce que verra le lecteur**, pas sur les octets de
 * la source. Un `_italique_` réécrit en `*italique*` produit la même page : ce
 * n'est pas une perte. Un bloc HTML évaporé, si. On compare donc le HTML rendu,
 * espaces normalisés.
 */
function normalizeRendered(md: string): string {
	// Les espaces en fin de ligne ne changent rien au rendu (`breaks: true` fait
	// déjà d'un simple retour à la ligne un `<br>`), mais ils suffiraient à faire
	// crier au faux positif.
	const trimmed = md
		.split("\n")
		.map((l) => l.replace(/[ \t]+$/, ""))
		.join("\n");
	return markdownToHtml(trimmed).replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

export type RoundTripReport = {
	/** `true` si relire puis réécrire la source la laisse inchangée. */
	faithful: boolean;
	/** Source telle qu'elle serait réenregistrée (utile au diagnostic). */
	rewritten: string;
};

/** Vérifie qu'un aller-retour markdown → document → markdown est fidèle. */
export function roundTripReport(source: string, extensions: Extensions): RoundTripReport {
	try {
		const rewritten = serializeMarkdown(parseMarkdown(source, extensions));
		return { faithful: normalizeRendered(rewritten) === normalizeRendered(source), rewritten };
	} catch {
		return { faithful: false, rewritten: source };
	}
}
