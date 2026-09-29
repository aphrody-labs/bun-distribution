/**
 * Conservation **fidèle du HTML libre** écrit à la main dans le wiki.
 *
 * Le wiki autorise la mise en page HTML complète (cf. sanitizer volontairement
 * ouvert). Un éditeur riche qui ne connaîtrait que ses propres blocs jetterait
 * silencieusement ce HTML au premier enregistrement : c'est la façon classique
 * de corrompre des années de contenu. Deux filets ici :
 *
 *   - `htmlContainer` — tout conteneur inconnu (`div`, `section`, `aside`…)
 *     garde sa balise, ses classes et son style, et **son contenu reste éditable**
 *     (les enfants sont parsés normalement) ;
 *   - `htmlBlock` — dernier recours pour ce qui n'a pas de sens en tant que
 *     contenu éditable (`svg`, `video`, balise exotique) : le HTML d'origine est
 *     conservé octet pour octet et ré-émis tel quel à la sérialisation.
 *
 * Priorités de parsing basses (8 et 5) : tous les nœuds « connus » passent avant.
 */
import { Node } from "@tiptap/core";

/** Balises conteneurs dont on préserve l'enveloppe mais dont on édite le contenu. */
const CONTAINER_TAGS = ["div", "section", "aside", "article", "header", "footer", "nav"] as const;

export const HtmlContainer = Node.create({
	name: "htmlContainer",
	group: "block",
	content: "block+",
	defining: true,

	addAttributes() {
		return {
			tag: {
				default: "div",
				parseHTML: (el: HTMLElement) => el.tagName.toLowerCase(),
				renderHTML: () => ({}),
			},
			class: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute("class"),
				renderHTML: (attrs: Record<string, unknown>) =>
					attrs.class ? { class: String(attrs.class) } : {},
			},
			style: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute("style"),
				renderHTML: (attrs: Record<string, unknown>) =>
					attrs.style ? { style: String(attrs.style) } : {},
			},
			id: {
				default: null,
				parseHTML: (el: HTMLElement) => el.getAttribute("id"),
				renderHTML: (attrs: Record<string, unknown>) => (attrs.id ? { id: String(attrs.id) } : {}),
			},
		};
	},

	parseHTML() {
		return CONTAINER_TAGS.map((tag) => ({ tag, priority: 8 }));
	},

	renderHTML({ node, HTMLAttributes }) {
		return [String(node.attrs.tag || "div"), HTMLAttributes, 0];
	},
});

export const HtmlBlock = Node.create({
	name: "htmlBlock",
	group: "block",
	atom: true,
	draggable: true,
	selectable: true,

	addAttributes() {
		return {
			html: {
				default: "",
				parseHTML: (el: HTMLElement) => el.outerHTML,
				renderHTML: (attrs: Record<string, unknown>) => ({ "data-html": String(attrs.html ?? "") }),
			},
		};
	},

	parseHTML() {
		return [
			{ tag: "svg", priority: 5 },
			{ tag: "video", priority: 5 },
			{ tag: "audio", priority: 5 },
		];
	},

	/**
	 * Rendu **statique** : on ne peut pas émettre du HTML brut depuis un
	 * `DOMOutputSpec`. Le chemin réel de publication du wiki est la sérialisation
	 * markdown (qui, elle, réinjecte `attrs.html` verbatim) ; ce rendu-ci n'est
	 * qu'un porteur inerte pour les rares aperçus DOM.
	 */
	renderHTML({ node }) {
		return ["div", { class: "wiki-raw", "data-html": String(node.attrs.html ?? "") }];
	},

	/** En édition, on affiche vraiment le HTML (inerte, non éditable). */
	addNodeView() {
		return ({ node }) => {
			const dom = document.createElement("div");
			dom.className = "ed-raw";
			dom.contentEditable = "false";
			dom.setAttribute("data-drag-handle", "");
			dom.innerHTML = String(node.attrs.html ?? "");
			return { dom };
		};
	},
});
