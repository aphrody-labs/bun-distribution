/**
 * Rendu markdown enrichi pour les pages wiki libres (table WikiPage).
 *
 * Contrairement au rendu markdown basique, ce composant active :
 *   - `rehype-raw` : le HTML inline écrit dans le markdown est rendu (figures
 *     flottantes, colonnes, infobox…), ce qui permet une vraie mise en page wiki.
 *   - `rehype-sanitize` : nettoie ce HTML (schéma étendu, mais pas de <script>).
 *   - réécriture des `src` d'images : un chemin DB (`./assets/...`) ou relatif est
 *     converti en URL CDN du bot via assetUrl().
 *
 * Le seul rédacteur est l'admin authentifié (owner) → on autorise `className` et
 * `style` pour laisser la liberté de mise en page. `style` ne peut pas exécuter
 * de JS (les navigateurs bloquent `javascript:`/`expression()` en CSS).
 *
 * Isomorphe : utilisable en RSC (page wiki) comme en Client Component (preview
 * de l'éditeur). Ne pas ajouter "use client" ici.
 */
import { assetUrl } from "@/lib/assets";
import { ZoomableImage } from "./ZoomableImage";
import ReactMarkdown from "react-markdown";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Schéma de sanitisation « contrôle total du design » (rédacteur = owner de
 * confiance). On autorise toute la surface *mise en page + média + embed* :
 * conteneurs (`section`/`article`/`div`/colonnes), `style`/`class`/couleurs
 * inline, images/`video`/`audio`/`iframe` (embeds), tableaux, etc.
 *
 * Ce qui reste INTERDIT (et le restera) — ce n'est pas du design, c'est de
 * l'exécutable, donc un vecteur XSS sur un site public : `<script>`, les
 * gestionnaires `on*` (non whitelistés → strippés), `<style>` global (pourrait
 * casser tout le chrome du site) et les protocoles dangereux (`javascript:`,
 * filtrés par rehype-sanitize via `protocols`). Le CSS inline (`style`) n'est
 * PAS exécutable (les navigateurs bloquent `javascript:`/`expression()` en CSS).
 */
export const wikiSanitizeSchema = {
	...defaultSchema,
	// rehype-sanitize préfixe les `id` en `user-content-` par défaut (anti DOM
	// clobbering). Or les ancres de titres (rehype-autolink-headings) pointent sur
	// `#slug` sans préfixe → désynchro qui casse le scroll. On vide le préfixe : le
	// seul rédacteur est l'admin (owner), pas de contenu hostile.
	clobberPrefix: "",
	tagNames: [
		...(defaultSchema.tagNames ?? []),
		// mise en page / sémantique
		"figure",
		"figcaption",
		"picture",
		"source",
		"section",
		"article",
		"aside",
		"header",
		"footer",
		"nav",
		"details",
		"summary",
		// inline / typo
		"mark",
		"abbr",
		"u",
		"small",
		"sub",
		"sup",
		"time",
		"wbr",
		"bdi",
		"bdo",
		// média / embed
		"video",
		"audio",
		"track",
		"iframe",
		// tableaux
		"col",
		"colgroup",
		"caption",
	],
	attributes: {
		...defaultSchema.attributes,
		"*": [
			...(defaultSchema.attributes?.["*"] ?? []),
			"className",
			"style",
			"id",
			"title",
			"role",
			"lang",
			"dir",
		],
		img: [
			...(defaultSchema.attributes?.img ?? []),
			"src",
			"alt",
			"title",
			"width",
			"height",
			"loading",
			"decoding",
			"srcSet",
			"sizes",
		],
		source: ["src", "srcSet", "type", "media", "sizes", "width", "height"],
		video: [
			"src",
			"poster",
			"width",
			"height",
			"controls",
			"autoPlay",
			"loop",
			"muted",
			"playsInline",
			"preload",
		],
		audio: ["src", "controls", "loop", "muted", "preload"],
		track: ["src", "kind", "srcLang", "label", "default"],
		iframe: [
			"src",
			"width",
			"height",
			"title",
			"loading",
			"allow",
			"allowFullScreen",
			"frameBorder",
			"referrerPolicy",
			"sandbox",
		],
		// Le schéma GitHub restreint `className` de <a> à la seule valeur footnote
		// (`['className','data-footnote-backref']`), ce qui écrase la règle globale
		// `*` et viderait nos classes (ex. `wiki-btn`). On retire cette restriction
		// → `className` libre via `*`, tout en gardant href/id/aria par défaut.
		a: [
			...(defaultSchema.attributes?.a ?? []).filter(
				(x) => !(Array.isArray(x) && x[0] === "className")
			),
			"target",
			"rel",
			"download",
		],
		td: [...(defaultSchema.attributes?.td ?? []), "colSpan", "rowSpan"],
		th: [...(defaultSchema.attributes?.th ?? []), "colSpan", "rowSpan", "scope"],
		col: ["span", "width"],
		colgroup: ["span"],
	},
};
const schema = wikiSanitizeSchema;

export function WikiMarkdown({ body }: { body: string }) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm, remarkBreaks]}
			// Ordre critique : slug + autolink AVANT sanitize. rehype-slug pose un
			// `id` sur chaque titre (deep-link `#ancre`), autolink-headings emballe
			// le titre dans un `<a href="#id">`. `id` est déjà whitelisté (sur `*`)
			// dans `schema`, donc sanitize ne strippe pas les ancres.
			rehypePlugins={[
				rehypeRaw,
				rehypeSlug,
				[rehypeAutolinkHeadings, { behavior: "wrap" }],
				[rehypeSanitize, schema],
			]}
			components={{
				// Le corps est TOUJOURS posé sous le titre de sa page, qui porte déjà
				// le seul `<h1>`. Un `# Titre` en tête de corps en produisait un second
				// (mesuré sur /wiki/histoire-et-physiologie-des-saiyans et
				// /wiki/guide-officiel-power-scaling-sentoryoku-kiri) : il descend d'un
				// niveau, ses sous-titres restent ce qu'ils sont.
				h1: ({ node: _node, ...props }) => (
					<h2 {...(props as React.HTMLAttributes<HTMLHeadingElement>)} />
				),
				img: ({ src, alt, node: _node, ...props }) => (
					<ZoomableImage
						{...(props as React.ImgHTMLAttributes<HTMLImageElement>)}
						src={assetUrl(typeof src === "string" ? src : "")}
						alt={alt ?? ""}
					/>
				),
				// Sous-catégories repliables : ouvertes par défaut (sinon la page paraît
				// vide derrière des sections fermées). L'utilisateur peut toujours les
				// replier — `open` reste un état natif <details>.
				details: ({ node: _node, open, children, ...props }) => (
					<details
						{...(props as React.DetailsHTMLAttributes<HTMLDetailsElement>)}
						open={(open as boolean | undefined) ?? true}
					>
						{children}
					</details>
				),
			}}
		>
			{body}
		</ReactMarkdown>
	);
}
