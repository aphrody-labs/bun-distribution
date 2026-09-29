/**
 * Nœuds **en ligne** propres à l'univers du site : badge de niveau de puissance
 * (Ki) et bouton d'action. Atomiques (insérés/supprimés d'un bloc), mais leurs
 * attributs restent modifiables via la barre contextuelle.
 */
import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		editorInline: {
			insertKiBadge: (attrs: { ctx: string; value: string }) => ReturnType;
			insertActionButton: (attrs: { label: string; href: string }) => ReturnType;
		};
	}
}

export const KiBadge = Node.create({
	name: "kiBadge",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			ctx: {
				default: "Ki",
				parseHTML: (el: HTMLElement) =>
					el.querySelector(".ki-power-ctx")?.textContent?.trim() || "Ki",
			},
			value: {
				default: "",
				parseHTML: (el: HTMLElement) =>
					el.querySelector(".ki-power-val")?.textContent?.trim() ?? "",
			},
		};
	},

	parseHTML() {
		return [{ tag: "span.ki-power", priority: 70 }];
	},

	renderHTML({ node }) {
		return [
			"span",
			{ class: "ki-power" },
			["span", { class: "ki-power-ctx" }, String(node.attrs.ctx ?? "")],
			["span", { class: "ki-power-val" }, String(node.attrs.value ?? "")],
		];
	},

	addCommands() {
		return {
			insertKiBadge:
				(attrs) =>
				({ commands }) =>
					commands.insertContent([
						{ type: this.name, attrs },
						{ type: "text", text: " " },
					]),
		};
	},
});

export const ActionButton = Node.create({
	name: "actionButton",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,

	addAttributes() {
		return {
			label: {
				default: "Bouton",
				parseHTML: (el: HTMLElement) => el.textContent?.trim() || "Bouton",
			},
			href: {
				default: "#",
				parseHTML: (el: HTMLElement) => el.getAttribute("href") ?? "#",
			},
		};
	},

	parseHTML() {
		return [{ tag: "a.wiki-btn", priority: 70 }];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			"a",
			mergeAttributes(HTMLAttributes, { class: "wiki-btn", href: String(node.attrs.href ?? "#") }),
			String(node.attrs.label ?? "Bouton"),
		];
	},

	addCommands() {
		return {
			insertActionButton:
				(attrs) =>
				({ commands }) =>
					commands.insertContent([
						{ type: this.name, attrs },
						{ type: "text", text: " " },
					]),
		};
	},
});
