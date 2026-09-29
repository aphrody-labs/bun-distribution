/**
 * Plain-text projection of markdown, for every place that renders a TEXT NODE
 * rather than a markdown tree: index cards, `<meta name="description">`,
 * JSON-LD, search snippets, crawled excerpts.
 *
 * Several editorial columns are markdown (`db_sagas.description`,
 * `db_arcs.description`, `db_databooks.description`, RAG chunks, crawled
 * source excerpts). Rendered as `{value}`, their syntax reached the reader
 * verbatim: `**tomes 20 à 24**` and `*Dragon Ball Z*` on /wiki/sagas and
 * /wiki/chronologie, `[Login](/login)` in the excerpts of /sources/dragon-ball,
 * `Pok&eacute;mon` in crawled titles. Detail pages keep rendering the
 * markdown itself (`WikiMarkdown`); this module is only for text slots.
 *
 * Pure and dependency-free: importable from server and client components.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	shy: "",
	eacute: "é",
	Eacute: "É",
	egrave: "è",
	Egrave: "È",
	ecirc: "ê",
	Ecirc: "Ê",
	euml: "ë",
	agrave: "à",
	Agrave: "À",
	acirc: "â",
	Acirc: "Â",
	auml: "ä",
	aacute: "á",
	ccedil: "ç",
	Ccedil: "Ç",
	icirc: "î",
	iuml: "ï",
	iacute: "í",
	ocirc: "ô",
	ouml: "ö",
	oacute: "ó",
	ntilde: "ñ",
	ugrave: "ù",
	ucirc: "û",
	uuml: "ü",
	uacute: "ú",
	oelig: "œ",
	OElig: "Œ",
	aelig: "æ",
	szlig: "ß",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	laquo: "«",
	raquo: "»",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	middot: "·",
	bull: "•",
	copy: "©",
	reg: "®",
	trade: "™",
	deg: "°",
	times: "×",
	star: "☆",
};

/** Decodes numeric and common named HTML character references. Unknown ones are kept. */
export function decodeHtmlEntitiesPlain(input: string): string {
	return input.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (match, ref: string) => {
		if (ref.startsWith("#")) {
			const hex = ref[1] === "x" || ref[1] === "X";
			const code = Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
			return Number.isInteger(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return NAMED_ENTITIES[ref] ?? match;
	});
}

export type MarkdownPlainOptions = {
	/** Truncate to this many characters (ellipsis included), on a word boundary when possible. */
	max?: number;
	/** Keep paragraph and line breaks (for `whitespace-pre-line` slots). Default: single line. */
	lineBreaks?: boolean;
};

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, Math.max(1, max - 1));
	const space = cut.lastIndexOf(" ");
	const base = space >= max - 30 && space > 0 ? cut.slice(0, space) : cut;
	return `${base.replace(/[\s,;:.\-–—]+$/u, "")}…`;
}

/**
 * Removes markdown syntax (and stray HTML) while keeping the words.
 *
 * `null`/`undefined` → `""`, so call sites can keep their `value && …` guards.
 */
export function markdownToPlainText(
	input: string | null | undefined,
	options: MarkdownPlainOptions = {}
): string {
	if (!input) return "";
	let text = input
		.replace(/\r\n?/g, "\n")
		.replace(/<!--[\s\S]*?-->/g, " ")
		// Code fences: keep the code, drop the fence lines.
		.replace(/^\s*(```|~~~).*$/gm, "")
		// Images (also inside links: `[![logo](a.png)](/)` becomes `[ ](/)`).
		.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, " ")
		// Inline links, with an optional title.
		.replace(/\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"\n]*")?\)/g, "$1")
		// Reference links and their definitions.
		.replace(/^\s{0,3}\[[^\]\n]+\]:\s+\S+.*$/gm, "")
		.replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, "$1")
		// Autolinks, then any remaining HTML tag.
		.replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
		.replace(/<\/?[A-Za-z][^>\n]*>/g, " ")
		// Block syntax.
		.replace(/^\s{0,3}#{1,6}[ \t]+/gm, "")
		.replace(/^\s{0,3}(?:=+|-{3,}|\*(?:[ \t]*\*){2,}|_(?:[ \t]*_){2,})[ \t]*$/gm, "")
		.replace(/^\s{0,3}>[ \t]?/gm, "")
		.replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+(?=\S)/gm, "")
		// Tables: separator rows go, cells are joined with a middle dot.
		.replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*(?::?-{3,}:?)?[ \t]*$/gm, "")
		.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) =>
			row
				.split("|")
				.map((cell) => cell.trim())
				.filter(Boolean)
				.join(" · ")
		)
		// Inline emphasis, strike-through and code (single line only).
		.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "$1")
		.replace(/__(?=\S)([^\n]*?\S)__/g, "$1")
		.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, "$1$2")
		.replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1$2")
		.replace(/~~(?=\S)([^\n]*?\S)~~/g, "$1")
		.replace(/`([^`\n]+)`/g, "$1")
		// Unbalanced leftovers and backslash escapes.
		.replace(/\*{2,}/g, "")
		.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1");

	text = decodeHtmlEntitiesPlain(text);

	text = options.lineBreaks
		? text
				.split("\n")
				.map((line) => line.replace(/[ \t ]+/g, " ").trim())
				.join("\n")
				.replace(/\n{3,}/g, "\n\n")
				.trim()
		: text.replace(/\s+/g, " ").trim();

	return options.max ? truncate(text, options.max) : text;
}
