/**
 * Découpe un article wiki long-format (markdown) en **sections navigables** par
 * titre de niveau 2 (`## …`). Chaque section devient une « catégorie » du
 * sélecteur de la fiche (Histoire, Personnalité, Pouvoirs et techniques,
 * Transformations, Anecdotes, PWS…). Le contenu existe déjà tel quel dans la DB
 * (`db_characters.article` etc.) — on ne fait que le **structurer**, donc aucune
 * fabrication et le SEO reste préservé (tout est rendu côté serveur).
 *
 * Robuste : blocs de code clôturés (``` / ~~~) ignorés, préambule avant le 1er
 * `##` rattaché à la 1re section, titres dupliqués → clés suffixées. Module pur
 * (aucun accès DB / JSX) → importable côté serveur comme client.
 */

export type { SectionAccent } from "@/lib/wiki-section-accents";
export { sectionAccent } from "@/lib/wiki-section-accents";

import { sectionAccent, type SectionAccent } from "@/lib/wiki-section-accents";

export interface ArticleSection {
	/** Slug unique de la section (clé React + pilule + ancre). */
	key: string;
	/** Libellé affiché (titre H2 d'origine). */
	label: string;
	/** Corps markdown de la section, titre H2 retiré (rendu comme heading à part). */
	body: string;
	accent: SectionAccent;
}

/** Slug ASCII stable depuis un libellé (accents retirés, non-alphanum → tiret). */
export function sectionSlug(label: string): string {
	return (
		label
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "section"
	);
}

/**
 * Sépare `article` sur ses titres H2 (`## `) — en ignorant les `##` situés dans
 * un bloc de code clôturé. Les sous-titres `###`+ restent dans le corps de leur
 * section. Le texte avant le 1er H2 est rattaché en tête de la 1re section. Sans
 * aucun H2, une unique section (`fallbackLabel`) porte tout l'article.
 */
export function splitArticleSections(
	article: string | null | undefined,
	fallbackLabel = "Histoire"
): ArticleSection[] {
	const src = (article ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!src.trim()) return [];

	const lines = src.split("\n");
	let inFence = false;
	let fenceChar = "";
	const preamble: string[] = [];
	const blocks: Array<{ label: string; lines: string[] }> = [];
	let current: { label: string; lines: string[] } | null = null;

	for (const line of lines) {
		const fence = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence) {
			const ch = fence[1][0];
			if (!inFence) {
				inFence = true;
				fenceChar = ch;
			} else if (ch === fenceChar) {
				inFence = false;
				fenceChar = "";
			}
		}

		// H2 = exactement `## ` (pas `#`, pas `###`). Trailing `#` optionnels tolérés.
		const h2 = !inFence ? /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line) : null;
		if (h2) {
			current = { label: h2[1].trim(), lines: [] };
			blocks.push(current);
		} else if (current) {
			current.lines.push(line);
		} else {
			preamble.push(line);
		}
	}

	if (blocks.length === 0) {
		return [
			{ key: sectionSlug(fallbackLabel), label: fallbackLabel, body: src.trim(), accent: "orange" },
		];
	}

	const pre = preamble.join("\n").trim();
	if (pre) blocks[0].lines.unshift(pre, "");

	const seen = new Set<string>();
	return (
		blocks
			.map((b) => {
				let key = sectionSlug(b.label);
				let n = 2;
				while (seen.has(key)) key = `${sectionSlug(b.label)}-${n++}`;
				seen.add(key);
				return {
					key,
					label: b.label,
					body: b.lines.join("\n").trim(),
					accent: sectionAccent(b.label),
				};
			})
			// Section vide (titre sans corps) : ignorée, comme les sections DB vides.
			.filter((s) => s.body.length > 0)
	);
}

/**
 * Clés de section (slug) reconnues comme « techniques » / « transformations » :
 * si une section de contenu porte l'une d'elles, la galerie relationnelle
 * (fiches techniques / vignettes de transformations) est fusionnée dans ce
 * panneau au lieu d'ajouter une pilule en double.
 */
export const TECH_SECTION_KEYS = new Set([
	"techniques",
	"pouvoirs-et-techniques",
	"pouvoirs-et-capacites",
	"pouvoirs",
	"capacites",
	"techniques-et-capacites",
	"pouvoirs-et-competences",
]);

export const TRANSFO_SECTION_KEYS = new Set([
	"transformations",
	"transformations-et-fusions",
	"transformations-et-formes",
	"formes",
	"fusions",
]);
