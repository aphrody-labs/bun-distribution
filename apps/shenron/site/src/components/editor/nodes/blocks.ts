/**
 * Nœuds de bloc « design » du module d'édition — le vocabulaire de mise en page
 * partagé par TOUS les éditeurs du site (articles, wiki, sections CMS, home).
 *
 * Ces définitions sont **client-safe et isomorphes** : uniquement `@tiptap/core`,
 * aucun import React ni navigateur au niveau module. Elles sont donc utilisables
 * par l'éditeur (navigateur), par le rendu HTML serveur des articles
 * (`renderToHTMLString`) et par le pont markdown (parse/sérialisation).
 *
 * Le balisage produit est **exactement** celui déjà stocké dans le wiki
 * (`wiki-callout`, `wiki-cols`, `details.wiki-section`…) : ouvrir une page
 * existante dans l'éditeur riche ne la réécrit pas.
 */
import { Node, mergeAttributes } from "@tiptap/core";

/** Attribut HTML simple : lu tel quel, écrit seulement s'il est non vide. */
function passthroughAttr(name: string, fallback: string | null = null) {
	return {
		default: fallback,
		parseHTML: (el: HTMLElement) => el.getAttribute(name) ?? fallback,
		renderHTML: (attrs: Record<string, unknown>) => {
			const v = attrs[name];
			return v ? { [name]: String(v) } : {};
		},
	};
}

/* -------------------------------------------------------------------------- */
/* Encadré (callout)                                                          */
/* -------------------------------------------------------------------------- */

const CALLOUT_KINDS = ["info", "success", "warn", "danger", "neutral"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		wikiBlocks: {
			setCallout: (kind: CalloutKind) => ReturnType;
			toggleCallout: (kind: CalloutKind) => ReturnType;
			insertColumns: (count: 2 | 3) => ReturnType;
			insertDetailsSection: (summary: string) => ReturnType;
			insertEmbed: (src: string) => ReturnType;
			insertBanner: (src: string) => ReturnType;
			insertGallery: (sources: string[]) => ReturnType;
			insertSpacer: (height: number) => ReturnType;
			insertFigure: (attrs: {
				src: string;
				alt?: string;
				placement?: FigurePlacement;
				size?: FigureSize;
			}) => ReturnType;
			setFigureLayout: (attrs: { placement?: FigurePlacement; size?: FigureSize }) => ReturnType;
		};
	}
}

export const Callout = Node.create({
	name: "callout",
	group: "block",
	content: "block+",
	defining: true,

	addAttributes() {
		return {
			kind: {
				default: "info" as CalloutKind,
				parseHTML: (el: HTMLElement) => {
					const found = CALLOUT_KINDS.find((k) => el.classList.contains(`wiki-callout--${k}`));
					return found ?? "info";
				},
				renderHTML: () => ({}), // porté par la classe, pas par un attribut
			},
		};
	},

	parseHTML() {
		return [{ tag: "div.wiki-callout", priority: 60 }];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				class: `wiki-callout wiki-callout--${node.attrs.kind}`,
			}),
			0,
		];
	},

	addCommands() {
		return {
			setCallout:
				(kind) =>
				({ commands }) =>
					commands.wrapIn(this.name, { kind }),
			toggleCallout:
				(kind) =>
				({ commands }) =>
					commands.toggleWrap(this.name, { kind }),
		};
	},
});

/* -------------------------------------------------------------------------- */
/* Colonnes                                                                   */
/* -------------------------------------------------------------------------- */

export const Column = Node.create({
	name: "column",
	content: "block+",
	isolating: true,

	parseHTML() {
		// Sélecteur enfant direct : seules les colonnes d'une grille `wiki-cols`
		// deviennent des colonnes (un `div` quelconque reste un conteneur libre).
		return [{ tag: "div.wiki-cols > div", priority: 65 }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["div", HTMLAttributes, 0];
	},
});

export const Columns = Node.create({
	name: "columns",
	group: "block",
	content: "column{2,4}",
	isolating: true,

	addAttributes() {
		return {
			count: {
				default: 2,
				parseHTML: (el: HTMLElement) => {
					const m = el.className.match(/wiki-cols-(\d)/);
					return m ? Number(m[1]) : el.children.length || 2;
				},
				renderHTML: () => ({}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "div.wiki-cols", priority: 65 }];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, { class: `wiki-cols wiki-cols-${node.attrs.count}` }),
			0,
		];
	},

	addCommands() {
		return {
			insertColumns:
				(count) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: { count },
						content: Array.from({ length: count }, (_, i) => ({
							type: "column",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: `Colonne ${i + 1}` }],
								},
							],
						})),
					}),
		};
	},
});

/* -------------------------------------------------------------------------- */
/* Section repliable (<details class="wiki-section">)                          */
/* -------------------------------------------------------------------------- */

export const DetailsSummary = Node.create({
	name: "detailsSummary",
	content: "inline*",
	defining: true,
	isolating: true,
	selectable: false,

	parseHTML() {
		return [{ tag: "summary", priority: 60 }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["summary", HTMLAttributes, 0];
	},
});

export const DetailsSection = Node.create({
	name: "detailsSection",
	group: "block",
	content: "detailsSummary block+",
	defining: true,

	parseHTML() {
		return [{ tag: "details", priority: 60 }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["details", mergeAttributes(HTMLAttributes, { class: "wiki-section" }), 0];
	},

	/**
	 * En édition, un `<details>` fermé masque son contenu : on force `open` sur la
	 * vue (le HTML publié, lui, reste replié par défaut — page compacte).
	 */
	addNodeView() {
		return () => {
			const dom = document.createElement("details");
			dom.className = "wiki-section";
			dom.open = true;
			// Empêche le repli au clic sur le résumé : le rédacteur doit pouvoir y
			// placer son curseur sans que le bloc se ferme sous ses doigts.
			dom.addEventListener("toggle", () => {
				if (!dom.open) dom.open = true;
			});
			return { dom, contentDOM: dom };
		};
	},

	addCommands() {
		return {
			insertDetailsSection:
				(summary) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						content: [
							{
								type: "detailsSummary",
								content: [{ type: "text", text: summary || "Section" }],
							},
							{ type: "paragraph" },
						],
					}),
		};
	},
});

/* -------------------------------------------------------------------------- */
/* Figure (image dimensionnée + placement + légende)                          */
/* -------------------------------------------------------------------------- */

const FIGURE_SIZES = ["sm", "md", "lg", "full"] as const;
export type FigureSize = (typeof FIGURE_SIZES)[number];
const FIGURE_PLACEMENTS = ["center", "left", "right"] as const;
export type FigurePlacement = (typeof FIGURE_PLACEMENTS)[number];

const PLACEMENT_CLASS: Record<FigurePlacement, string> = {
	center: "wiki-img",
	left: "wiki-float-left",
	right: "wiki-float-right",
};

export const Figure = Node.create({
	name: "figure",
	group: "block",
	content: "inline*", // la légende (facultative)
	draggable: true,
	isolating: true,

	addAttributes() {
		return {
			src: { default: "" },
			alt: { default: "" },
			placement: { default: "center" as FigurePlacement },
			size: { default: "md" as FigureSize },
		};
	},

	parseHTML() {
		return [
			{
				tag: "figure",
				priority: 60,
				getAttrs: (el) => {
					const node = el as HTMLElement;
					if (node.classList.contains("wiki-banner")) return false; // → nœud bannière
					const img = node.querySelector("img");
					if (!img) return false; // figure sans image → conteneur HTML libre
					const cls = node.className;
					const placement: FigurePlacement = cls.includes("wiki-float-left")
						? "left"
						: cls.includes("wiki-float-right")
							? "right"
							: "center";
					const sizeMatch = cls.match(/wiki-size-(sm|md|lg|full)/);
					return {
						src: img.getAttribute("src") ?? "",
						alt: img.getAttribute("alt") ?? "",
						placement,
						size: (sizeMatch?.[1] as FigureSize) ?? "md",
					};
				},
				// La légende est le contenu du nœud : on ne parse QUE le <figcaption>.
				// Sans légende, on fournit un élément vide — rendre l'élément `figure`
				// lui-même ferait re-parser l'`<img>` comme un bloc frère, et l'image
				// apparaîtrait deux fois (bug observé sur les fiches sans légende).
				contentElement: (el) =>
					(el as HTMLElement).querySelector("figcaption") ??
					(el as HTMLElement).ownerDocument.createElement("figcaption"),
			},
		];
	},

	renderHTML({ node }) {
		const { src, alt, placement, size } = node.attrs as {
			src: string;
			alt: string;
			placement: FigurePlacement;
			size: FigureSize;
		};
		return [
			"figure",
			{ class: `${PLACEMENT_CLASS[placement] ?? "wiki-img"} wiki-size-${size}` },
			["img", { src, alt, loading: "lazy", decoding: "async" }],
			["figcaption", {}, 0],
		];
	},

	addCommands() {
		return {
			insertFigure:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({ type: this.name, attrs }),
			setFigureLayout:
				(attrs) =>
				({ commands }) =>
					commands.updateAttributes(this.name, attrs),
		};
	},
});

/* -------------------------------------------------------------------------- */
/* Bannière, galerie, embed, espace                                           */
/* -------------------------------------------------------------------------- */

export const Banner = Node.create({
	name: "banner",
	group: "block",
	content: "inline*", // le titre superposé
	defining: true,

	addAttributes() {
		return {
			src: {
				default: "",
				parseHTML: (el: HTMLElement) => {
					const m = el.getAttribute("style")?.match(/url\(['"]?([^'")]+)['"]?\)/);
					return m?.[1] ?? "";
				},
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: "figure.wiki-banner",
				priority: 70,
				contentElement: (el) =>
					(el as HTMLElement).querySelector("figcaption") ??
					(el as HTMLElement).ownerDocument.createElement("figcaption"),
			},
		];
	},

	renderHTML({ node }) {
		return [
			"figure",
			{ class: "wiki-banner", style: `background-image:url('${node.attrs.src}')` },
			["figcaption", {}, 0],
		];
	},

	addCommands() {
		return {
			insertBanner:
				(src) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs: { src },
						content: [{ type: "text", text: "Titre de la bannière" }],
					}),
		};
	},
});

export const Gallery = Node.create({
	name: "gallery",
	group: "block",
	content: "image+",
	isolating: true,

	parseHTML() {
		return [{ tag: "div.wiki-grid", priority: 65 }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["div", mergeAttributes(HTMLAttributes, { class: "wiki-grid" }), 0];
	},

	addCommands() {
		return {
			insertGallery:
				(sources) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						content: (sources.length ? sources : ["", "", ""]).map((src) => ({
							type: "image",
							attrs: { src, alt: "" },
						})),
					}),
		};
	},
});

export const Embed = Node.create({
	name: "embed",
	group: "block",
	atom: true,
	draggable: true,
	selectable: true,

	addAttributes() {
		return {
			src: {
				default: "",
				parseHTML: (el: HTMLElement) =>
					el.tagName === "IFRAME"
						? (el.getAttribute("src") ?? "")
						: (el.querySelector("iframe")?.getAttribute("src") ?? ""),
			},
			title: passthroughAttr("title", "Vidéo"),
		};
	},

	parseHTML() {
		return [
			{ tag: "div.wiki-embed", priority: 65 },
			{ tag: "iframe", priority: 55 },
		];
	},

	renderHTML({ node }) {
		return [
			"div",
			{ class: "wiki-embed" },
			[
				"iframe",
				{
					src: node.attrs.src,
					title: node.attrs.title ?? "Vidéo",
					loading: "lazy",
					allow:
						"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
					allowfullscreen: "true",
				},
			],
		];
	},

	addCommands() {
		return {
			insertEmbed:
				(src) =>
				({ commands }) =>
					commands.insertContent({ type: this.name, attrs: { src } }),
		};
	},
});

export const Spacer = Node.create({
	name: "spacer",
	group: "block",
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			height: {
				default: 48,
				parseHTML: (el: HTMLElement) => {
					const m = el.getAttribute("style")?.match(/height:\s*(\d+)/);
					return m ? Number(m[1]) : 48;
				},
			},
		};
	},

	parseHTML() {
		return [{ tag: "div.wiki-spacer", priority: 65 }];
	},

	renderHTML({ node }) {
		return ["div", { class: "wiki-spacer", style: `height:${node.attrs.height}px` }];
	},

	addCommands() {
		return {
			insertSpacer:
				(height) =>
				({ commands }) =>
					commands.insertContent({ type: this.name, attrs: { height } }),
		};
	},
});
