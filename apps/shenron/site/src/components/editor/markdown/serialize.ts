/**
 * Sérialisation **document ProseMirror → markdown** (dialecte du wiki : markdown
 * GFM + HTML libre).
 *
 * Le wiki stocke du markdown, pas du JSON : c'est ce texte que lisent le rendu
 * public (`WikiMarkdown`), le RAG, les scripts d'ingest et les commandes Discord.
 * L'éditeur riche doit donc **rendre exactement le même dialecte** que celui
 * écrit à la main jusqu'ici — mêmes classes, mêmes blocs, mêmes lignes vides —
 * sinon une simple ouverture de page réécrirait tout son balisage.
 *
 * Client-safe et pur (aucune API navigateur) : testable et utilisable côté
 * serveur.
 */
import type { JSONContent } from "@tiptap/core";

type Ctx = {
	/** Préfixe de continuation (citations, listes imbriquées). */
	indent: string;
};

const BLANK = "\n\n";

/* -------------------------------------------------------------------------- */
/* Utilitaires                                                                */
/* -------------------------------------------------------------------------- */

function escapeHtmlAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeHtmlText(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Échappe ce qui, dans du texte brut, serait relu comme du markdown.
 *
 * Volontairement minimal : sur-échapper sème des `\` dans une source relue et
 * modifiée à la main depuis des années (les `_` de noms de fichiers, les `|` de
 * texte courant), sous-échapper transforme un `*` littéral en italique. On ne
 * traite donc que les caractères réellement ambigus, plus les amorces de bloc en
 * début de ligne. Les `|` sont échappés là où ils comptent : dans les cellules.
 */
function escapeMarkdown(text: string): string {
	let out = text.replace(/([\\`*<])/g, "\\$1");
	// Les crochets ne sont ambigus que s'ils dessinent un lien EN LIGNE
	// (`[texte](url)`). Les échapper systématiquement sèmerait des `\[` dans tout
	// le corpus (les appels de note « [3] », « [ 4 ] » des articles importés) ; les
	// liens par référence, eux, exigeraient une définition `[3]: …` pour se
	// déclencher — il n'y en a aucune dans le wiki.
	if (/\[[^\]\n]*\]\(/.test(out)) out = out.replace(/([[\]])/g, "\\$1");
	return (
		out
			// Un `#`, `-`, `+`, `>` ou `1.` en tête de ligne deviendrait un bloc.
			.replace(/^(\s*)([#>+-])/gm, "$1\\$2")
			.replace(/^(\s*)(\d+)\./gm, "$1$2\\.")
	);
}

/** Attributs HTML `class`/`style`/`id` d'un nœud, sous forme de chaîne prête. */
function attrString(attrs: Record<string, unknown>, keys: string[]): string {
	return keys
		.filter((k) => attrs[k])
		.map((k) => ` ${k}="${escapeHtmlAttr(String(attrs[k]))}"`)
		.join("");
}

/** Enveloppe un contenu markdown dans une balise HTML (lignes vides = markdown actif dedans). */
function htmlWrap(tag: string, attrs: string, inner: string): string {
	return `<${tag}${attrs}>\n\n${inner.trim()}\n\n</${tag}>`;
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                     */
/* -------------------------------------------------------------------------- */

function styleFromMark(attrs: Record<string, unknown>): string {
	const parts: string[] = [];
	if (attrs.color) parts.push(`color:${attrs.color}`);
	if (attrs.backgroundColor) parts.push(`background-color:${attrs.backgroundColor}`);
	if (attrs.fontSize) parts.push(`font-size:${attrs.fontSize}`);
	if (attrs.fontFamily) parts.push(`font-family:${attrs.fontFamily}`);
	if (attrs.lineHeight) parts.push(`line-height:${attrs.lineHeight}`);
	return parts.join(";");
}

/**
 * Ordre d'imbrication des marques, du plus extérieur au plus intérieur. Il
 * décide de `**texte *en italique* **` plutôt que l'inverse.
 */
const MARK_ORDER = [
	"link",
	"textStyle",
	"highlight",
	"underline",
	"subscript",
	"superscript",
	"strike",
	"bold",
	"italic",
	"code",
];

type Mark = { type: string; attrs?: Record<string, unknown> };

function markKey(mark: Mark): string {
	return `${mark.type}:${JSON.stringify(mark.attrs ?? {})}`;
}

function markRank(mark: Mark): number {
	const i = MARK_ORDER.indexOf(mark.type);
	return i < 0 ? 99 : i;
}

/** Applique une marque autour d'un fragment déjà sérialisé. */
function wrapMark(mark: Mark, inner: string): string {
	const a = (mark.attrs ?? {}) as Record<string, unknown>;
	switch (mark.type) {
		case "bold":
			return `**${inner}**`;
		case "italic":
			return `*${inner}*`;
		case "strike":
			return `~~${inner}~~`;
		case "underline":
			return `<u>${inner}</u>`;
		case "highlight":
			return a.color
				? `<mark style="background-color:${escapeHtmlAttr(String(a.color))}">${inner}</mark>`
				: `<mark>${inner}</mark>`;
		case "subscript":
			return `<sub>${inner}</sub>`;
		case "superscript":
			return `<sup>${inner}</sup>`;
		case "textStyle": {
			const style = styleFromMark(a);
			return style ? `<span style="${escapeHtmlAttr(style)}">${inner}</span>` : inner;
		}
		case "link":
			return `[${inner}](${String(a.href ?? "")})`;
		case "code": {
			// Un backtick dans le contenu impose un délimiteur plus long.
			const longest = (inner.match(/`+/g) ?? []).reduce((x, y) => Math.max(x, y.length), 0);
			const fence = "`".repeat(longest + 1);
			return `${fence}${inner}${fence}`;
		}
		default:
			return inner;
	}
}

/** Nœud en ligne dont toutes les marques ont déjà été appliquées. */
function serializeLeaf(node: JSONContent, raw: boolean): string {
	switch (node.type) {
		case "text":
			return raw ? (node.text ?? "") : escapeMarkdown(node.text ?? "");
		case "hardBreak":
			// `remark-breaks` est actif au rendu : un simple saut de ligne suffit.
			return "\n";
		case "image":
			return `![${escapeHtmlAttr(String(node.attrs?.alt ?? ""))}](${String(node.attrs?.src ?? "")})`;
		case "kiBadge": {
			const ctx = escapeHtmlText(String(node.attrs?.ctx ?? "Ki"));
			const val = escapeHtmlText(String(node.attrs?.value ?? ""));
			return `<span class="ki-power"><span class="ki-power-ctx">${ctx}</span><span class="ki-power-val">${val}</span></span>`;
		}
		case "actionButton":
			return `<a class="wiki-btn" href="${escapeHtmlAttr(String(node.attrs?.href ?? "#"))}">${escapeHtmlText(String(node.attrs?.label ?? "Bouton"))}</a>`;
		default:
			// Nœud en ligne inconnu : on tente son texte pour ne rien perdre.
			return node.text ?? serializeInline(node.content);
	}
}

/**
 * Sérialise une suite de nœuds en ligne en **regroupant les marques contiguës**.
 *
 * C'est le point délicat. Traiter chaque nœud isolément produit
 * `**gras***italique***gras**` — une bouillie d'astérisques que plus aucun
 * parseur ne relit correctement. Le cas n'a rien de théorique : les chapeaux de
 * fiches du wiki sont entièrement en gras et contiennent des titres d'œuvres en
 * italique. On repère donc, pour la marque la plus extérieure, la plus longue
 * plage de nœuds qui la partagent, on l'enveloppe **une seule fois**, puis on
 * récursive à l'intérieur.
 */
function serializeInlineRun(nodes: JSONContent[], applied: Set<string>, raw: boolean): string {
	let out = "";
	let i = 0;
	while (i < nodes.length) {
		const node = nodes[i]!;
		const pending = ((node.marks ?? []) as Mark[])
			.filter((m) => !applied.has(markKey(m)))
			.toSorted((a, b) => markRank(a) - markRank(b));

		if (pending.length === 0) {
			out += serializeLeaf(node, raw);
			i += 1;
			continue;
		}

		const mark = pending[0]!;
		const key = markKey(mark);
		let end = i;
		while (
			end + 1 < nodes.length &&
			((nodes[end + 1]!.marks ?? []) as Mark[]).some((m) => markKey(m) === key)
		) {
			end += 1;
		}
		const next = new Set(applied);
		next.add(key);
		out += wrapMark(
			mark,
			serializeInlineRun(nodes.slice(i, end + 1), next, raw || mark.type === "code")
		);
		i = end + 1;
	}
	return out;
}

function serializeInline(nodes: JSONContent[] | undefined): string {
	if (!nodes?.length) return "";
	return serializeInlineRun(nodes, new Set(), false);
}

/* -------------------------------------------------------------------------- */
/* Tableaux                                                                   */
/* -------------------------------------------------------------------------- */

/** Un tableau est « simple » (donc convertible en GFM) sans fusion ni bloc complexe. */
function isSimpleTable(rows: JSONContent[]): boolean {
	return rows.every((row) =>
		(row.content ?? []).every((cell) => {
			const a = cell.attrs ?? {};
			if ((a.colspan ?? 1) !== 1 || (a.rowspan ?? 1) !== 1) return false;
			const kids = cell.content ?? [];
			return kids.length <= 1 && (kids[0]?.type ?? "paragraph") === "paragraph";
		})
	);
}

function serializeTable(node: JSONContent): string {
	const rows = node.content ?? [];
	if (!rows.length) return "";
	if (!isSimpleTable(rows)) {
		// Fusion de cellules ou contenu riche : on garde un tableau HTML (le wiki
		// le rend tel quel) plutôt que d'aplatir et perdre la structure.
		const html = rows
			.map((row) => {
				const cells = (row.content ?? [])
					.map((cell) => {
						const tag = cell.type === "tableHeader" ? "th" : "td";
						const span = attrString(cell.attrs ?? {}, ["colspan", "rowspan"]);
						return `<${tag}${span}>${serializeBlocks(cell.content ?? [], { indent: "" }).trim()}</${tag}>`;
					})
					.join("");
				return `<tr>${cells}</tr>`;
			})
			.join("\n");
		return `<table>\n${html}\n</table>`;
	}

	const cellText = (cell: JSONContent) =>
		serializeInline(cell.content?.[0]?.content).replace(/\|/g, "\\|").trim();
	const [head, ...body] = rows;
	const headCells = (head.content ?? []).map(cellText);
	const lines = [
		`| ${headCells.join(" | ")} |`,
		`| ${headCells.map(() => "---").join(" | ")} |`,
		...body.map((row) => `| ${(row.content ?? []).map(cellText).join(" | ")} |`),
	];
	return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Blocs                                                                      */
/* -------------------------------------------------------------------------- */

function serializeList(node: JSONContent, ordered: boolean, ctx: Ctx): string {
	const start = Number(node.attrs?.start ?? 1);
	return (node.content ?? [])
		.map((item, i) => {
			const bullet = ordered ? `${start + i}. ` : "- ";
			const pad = " ".repeat(bullet.length);
			const inner = serializeBlocks(item.content ?? [], { indent: "" }).trim();
			const [first, ...rest] = inner.split("\n");
			const lines = [bullet + (first ?? ""), ...rest.map((l) => (l.trim() ? pad + l : ""))];
			return ctx.indent + lines.join(`\n${ctx.indent}`);
		})
		.join("\n");
}

function serializeBlock(node: JSONContent, ctx: Ctx): string {
	const attrs = (node.attrs ?? {}) as Record<string, unknown>;

	switch (node.type) {
		case "paragraph": {
			const text = serializeInline(node.content);
			if (!text.trim()) return "";
			if (attrs.textAlign && attrs.textAlign !== "left") {
				return `<p style="text-align:${attrs.textAlign}">${text}</p>`;
			}
			return text;
		}

		case "heading": {
			const level = Math.min(6, Math.max(1, Number(attrs.level ?? 2)));
			const text = serializeInline(node.content);
			if (attrs.textAlign && attrs.textAlign !== "left") {
				return `<h${level} style="text-align:${attrs.textAlign}">${text}</h${level}>`;
			}
			return `${"#".repeat(level)} ${text}`;
		}

		case "bulletList":
			return serializeList(node, false, ctx);
		case "orderedList":
			return serializeList(node, true, ctx);

		case "blockquote":
			return serializeBlocks(node.content ?? [], { indent: "" })
				.trim()
				.split("\n")
				.map((l) => (l ? `> ${l}` : ">"))
				.join("\n");

		case "codeBlock": {
			const lang = String(attrs.language ?? "");
			const body = (node.content ?? []).map((c) => c.text ?? "").join("");
			return `\`\`\`${lang}\n${body}\n\`\`\``;
		}

		case "horizontalRule":
			return "---";

		case "image":
			return `![${escapeHtmlAttr(String(attrs.alt ?? ""))}](${String(attrs.src ?? "")})`;

		case "figure": {
			const place =
				attrs.placement === "left"
					? "wiki-float-left"
					: attrs.placement === "right"
						? "wiki-float-right"
						: "wiki-img";
			const caption = serializeInline(node.content);
			const inner = `  <img src="${escapeHtmlAttr(String(attrs.src ?? ""))}" alt="${escapeHtmlAttr(String(attrs.alt ?? ""))}" />${caption ? `\n  <figcaption>${caption}</figcaption>` : ""}`;
			return `<figure class="${place} wiki-size-${String(attrs.size ?? "md")}">\n${inner}\n</figure>`;
		}

		case "banner":
			return `<figure class="wiki-banner" style="background-image:url('${escapeHtmlAttr(String(attrs.src ?? ""))}')">\n<figcaption>${serializeInline(node.content)}</figcaption>\n</figure>`;

		case "gallery":
			return `<div class="wiki-grid">\n${(node.content ?? [])
				.map(
					(img) =>
						`<img src="${escapeHtmlAttr(String(img.attrs?.src ?? ""))}" alt="${escapeHtmlAttr(String(img.attrs?.alt ?? ""))}" />`
				)
				.join("\n")}\n</div>`;

		case "embed":
			return `<div class="wiki-embed">\n<iframe src="${escapeHtmlAttr(String(attrs.src ?? ""))}" title="${escapeHtmlAttr(String(attrs.title ?? "Vidéo"))}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n</div>`;

		case "youtube":
			return `<div class="wiki-embed">\n<iframe src="${escapeHtmlAttr(String(attrs.src ?? ""))}" title="Vidéo YouTube" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>\n</div>`;

		case "spacer":
			return `<div class="wiki-spacer" style="height:${Number(attrs.height ?? 48)}px"></div>`;

		case "callout":
			return htmlWrap(
				"div",
				` class="wiki-callout wiki-callout--${String(attrs.kind ?? "info")}"`,
				serializeBlocks(node.content ?? [], { indent: "" })
			);

		case "columns":
			return `<div class="wiki-cols wiki-cols-${Number(attrs.count ?? 2)}">\n${(node.content ?? [])
				.map((col) => htmlWrap("div", "", serializeBlocks(col.content ?? [], { indent: "" })))
				.join("\n")}\n</div>`;

		case "detailsSection": {
			const [summary, ...rest] = node.content ?? [];
			const title = escapeHtmlText(serializeInline(summary?.content).trim() || "Section");
			return `<details class="wiki-section">\n<summary>${title}</summary>\n\n${serializeBlocks(rest, { indent: "" }).trim()}\n\n</details>`;
		}

		case "htmlContainer":
			return htmlWrap(
				String(attrs.tag ?? "div"),
				attrString(attrs, ["class", "style", "id"]),
				serializeBlocks(node.content ?? [], { indent: "" })
			);

		case "htmlBlock":
			// HTML conservé octet pour octet depuis l'ouverture du document.
			return String(attrs.html ?? "");

		case "table":
			return serializeTable(node);

		default:
			// Nœud inconnu : on sérialise ses enfants plutôt que de le perdre.
			return node.content ? serializeBlocks(node.content, ctx) : "";
	}
}

function serializeBlocks(nodes: JSONContent[], ctx: Ctx): string {
	return nodes
		.map((n) => serializeBlock(n, ctx))
		.filter((s) => s.length > 0)
		.join(BLANK);
}

/** Point d'entrée : document Tiptap → source markdown du wiki. */
export function serializeMarkdown(doc: JSONContent | null | undefined): string {
	if (!doc?.content?.length) return "";
	return `${serializeBlocks(doc.content, { indent: "" })
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}
