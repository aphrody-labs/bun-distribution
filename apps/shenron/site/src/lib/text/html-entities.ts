/**
 * Dependency-free HTML character reference decoder for crawled text.
 *
 * Pure module (no `server-only`, no I/O): it is imported by the site, by
 * `apps/shenron/site/scripts/*` and by `scripts/ops/*` alike.
 *
 * Semantics — chosen for crawled material and pinned by
 * `apps/shenron/site/tests/html-entities.test.ts`:
 *
 * - **One level per call.** `&amp;lt;` becomes `&lt;`, never `<`: a call
 *   emulates the single decoding step an HTML parser performs, so a text
 *   decoded once is a fixed point unless its source was itself double-escaped.
 *   A second level only ever comes from an explicit second call.
 * - **A reference must end with `;`.** Legacy semicolon-less forms (`&amp`,
 *   `&copy`) are left intact: in crawled prose and URLs they are far more often
 *   query separators (`?a=1&copy=2`) than references.
 * - **Unknown names stay intact byte for byte** (`&Peace;`, `&foo;`,
 *   `&constructor;`). Known names are the HTML 4 set plus the common HTML 5
 *   additions (case-sensitive, as in HTML).
 * - **Numeric references follow the WHATWG tokenizer**: 0, surrogates and code
 *   points above U+10FFFF become U+FFFD; 0x80–0x9F are read as Windows-1252
 *   (`&#146;` is `’`), exactly as browsers render them.
 * - **No-break space becomes a regular space** (`&nbsp;`, `&#160;`, `&#xA0;`):
 *   the crawled corpus is re-flowed, searched and embedded, never typeset.
 * - **`preserveUrls`** leaves URLs untouched — absolute, protocol-relative
 *   (`//host/…`), `www.` hosts and any token carrying a query string: a crawled
 *   URL is an identifier (the primary key of `public.external_source_records`,
 *   the seed of a wiki page id), and its query string is not prose.
 */

export type DecodeHtmlEntitiesOptions = {
	/** Leave URLs and query strings (up to the next whitespace, quote or angle bracket, raw or escaped) untouched. */
	preserveUrls?: boolean;
	/**
	 * Post-processes the text produced by each decoded reference, e.g. to make it
	 * inert for a markdown context. Receives the decoded text and the original
	 * reference (`&lt;`). Unknown references are never passed to it.
	 */
	transform?: (decoded: string, reference: string) => string;
};

/**
 * POSIX regular expression (PostgreSQL `~`) matching any candidate reference —
 * the SQL twin of the decoder's own pattern, for selecting rows to repair.
 */
export const HTML_ENTITY_SQL_PATTERN = "&([A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);";

const REFERENCE = /&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]*));/g;

/**
 * What ends a URL: whitespace and the characters that cannot appear raw in one
 * (`< > " ' \``), raw or escaped — in escaped HTML (`src=&quot;/a?b=1&amp;c=2&quot;`)
 * `&quot;` ends the URL while `&amp;` stays inside it. No reference contains
 * any of these, so splitting on them never cuts a reference in two.
 */
const URL_DELIMITER = /(\s+|[<>"'`]|&(?:lt|gt|quot|apos|#0*(?:34|39|60|62)|#[xX]0*(?:22|27|3[cCeE]));)/;
/** Absolute (`https://`), protocol-relative (`//host`) or bare `www.` start; bounded scheme keeps it linear. */
const URL_START = /(?:\b[A-Za-z][A-Za-z0-9+.-]{0,31}:)?\/\/|\bwww\./;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Assigns consecutive code points to space-separated names; `-` skips one. */
function run(start: number, names: string): [string, number][] {
	return names
		.split(" ")
		.map((name, offset): [string, number] => [name, start + offset])
		.filter(([name]) => name !== "-");
}

const NAMED = new Map<string, number>([
	// ISO 8859-1, U+00A0–U+00FF (HTML 4 `HTMLlat1`).
	...run(
		0xa0,
		"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr " +
			"deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
			"Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml " +
			"ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
			"agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml " +
			"eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml",
	),
	// Greek (HTML 4 `HTMLsymbol`); U+03A2 is unassigned.
	...run(0x391, "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega"),
	...run(0x3b1, "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega"),
	...run(0x2190, "larr uarr rarr darr harr"),
	...run(0x21d0, "lArr uArr rArr dArr hArr"),
	...run(0x2308, "lceil rceil lfloor rfloor"),
	// HTML 4 `HTMLspecial` and the remaining `HTMLsymbol` entries.
	["quot", 0x22],
	["amp", 0x26],
	["apos", 0x27],
	["lt", 0x3c],
	["gt", 0x3e],
	["OElig", 0x152],
	["oelig", 0x153],
	["Scaron", 0x160],
	["scaron", 0x161],
	["Yuml", 0x178],
	["fnof", 0x192],
	["circ", 0x2c6],
	["tilde", 0x2dc],
	["thetasym", 0x3d1],
	["upsih", 0x3d2],
	["piv", 0x3d6],
	["ensp", 0x2002],
	["emsp", 0x2003],
	["thinsp", 0x2009],
	["zwnj", 0x200c],
	["zwj", 0x200d],
	["lrm", 0x200e],
	["rlm", 0x200f],
	["ndash", 0x2013],
	["mdash", 0x2014],
	["lsquo", 0x2018],
	["rsquo", 0x2019],
	["sbquo", 0x201a],
	["ldquo", 0x201c],
	["rdquo", 0x201d],
	["bdquo", 0x201e],
	["dagger", 0x2020],
	["Dagger", 0x2021],
	["bull", 0x2022],
	["hellip", 0x2026],
	["permil", 0x2030],
	["prime", 0x2032],
	["Prime", 0x2033],
	["lsaquo", 0x2039],
	["rsaquo", 0x203a],
	["oline", 0x203e],
	["frasl", 0x2044],
	["euro", 0x20ac],
	["image", 0x2111],
	["weierp", 0x2118],
	["real", 0x211c],
	["trade", 0x2122],
	["alefsym", 0x2135],
	["crarr", 0x21b5],
	["forall", 0x2200],
	["part", 0x2202],
	["exist", 0x2203],
	["empty", 0x2205],
	["nabla", 0x2207],
	["isin", 0x2208],
	["notin", 0x2209],
	["ni", 0x220b],
	["prod", 0x220f],
	["sum", 0x2211],
	["minus", 0x2212],
	["lowast", 0x2217],
	["radic", 0x221a],
	["prop", 0x221d],
	["infin", 0x221e],
	["ang", 0x2220],
	["and", 0x2227],
	["or", 0x2228],
	["cap", 0x2229],
	["cup", 0x222a],
	["int", 0x222b],
	["there4", 0x2234],
	["sim", 0x223c],
	["cong", 0x2245],
	["asymp", 0x2248],
	["ne", 0x2260],
	["equiv", 0x2261],
	["le", 0x2264],
	["ge", 0x2265],
	["sub", 0x2282],
	["sup", 0x2283],
	["nsub", 0x2284],
	["sube", 0x2286],
	["supe", 0x2287],
	["oplus", 0x2295],
	["otimes", 0x2297],
	["perp", 0x22a5],
	["sdot", 0x22c5],
	["lang", 0x27e8],
	["rang", 0x27e9],
	["loz", 0x25ca],
	["spades", 0x2660],
	["clubs", 0x2663],
	["hearts", 0x2665],
	["diams", 0x2666],
	// Common HTML 5 additions (upper-case aliases, ASCII punctuation, typography).
	["AMP", 0x26],
	["LT", 0x3c],
	["GT", 0x3e],
	["QUOT", 0x22],
	["COPY", 0xa9],
	["REG", 0xae],
	["TRADE", 0x2122],
	["Tab", 0x09],
	["NewLine", 0x0a],
	["excl", 0x21],
	["num", 0x23],
	["dollar", 0x24],
	["percnt", 0x25],
	["lpar", 0x28],
	["rpar", 0x29],
	["ast", 0x2a],
	["plus", 0x2b],
	["comma", 0x2c],
	["period", 0x2e],
	["sol", 0x2f],
	["colon", 0x3a],
	["semi", 0x3b],
	["equals", 0x3d],
	["quest", 0x3f],
	["commat", 0x40],
	["lsqb", 0x5b],
	["lbrack", 0x5b],
	["bsol", 0x5c],
	["rsqb", 0x5d],
	["rbrack", 0x5d],
	["Hat", 0x5e],
	["lowbar", 0x5f],
	["grave", 0x60],
	["lcub", 0x7b],
	["lbrace", 0x7b],
	["verbar", 0x7c],
	["vert", 0x7c],
	["rcub", 0x7d],
	["rbrace", 0x7d],
	["NonBreakingSpace", 0xa0],
	["centerdot", 0xb7],
	["half", 0xbd],
	["hyphen", 0x2010],
	["dash", 0x2010],
	["horbar", 0x2015],
	["bullet", 0x2022],
	["mldr", 0x2026],
	["nldr", 0x2025],
	["ZeroWidthSpace", 0x200b],
	["NoBreak", 0x2060],
	["starf", 0x2605],
	["star", 0x2606],
	["check", 0x2713],
	["cross", 0x2717],
]);

/** WHATWG numeric character reference remapping of the C1 range (Windows-1252). */
const WINDOWS_1252 = new Map<number, number>([
	[0x80, 0x20ac],
	[0x82, 0x201a],
	[0x83, 0x0192],
	[0x84, 0x201e],
	[0x85, 0x2026],
	[0x86, 0x2020],
	[0x87, 0x2021],
	[0x88, 0x02c6],
	[0x89, 0x2030],
	[0x8a, 0x0160],
	[0x8b, 0x2039],
	[0x8c, 0x0152],
	[0x8e, 0x017d],
	[0x91, 0x2018],
	[0x92, 0x2019],
	[0x93, 0x201c],
	[0x94, 0x201d],
	[0x95, 0x2022],
	[0x96, 0x2013],
	[0x97, 0x2014],
	[0x98, 0x02dc],
	[0x99, 0x2122],
	[0x9a, 0x0161],
	[0x9b, 0x203a],
	[0x9c, 0x0153],
	[0x9e, 0x017e],
	[0x9f, 0x0178],
]);

function codePointText(codePoint: number): string {
	if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff) return "\uFFFD";
	if (codePoint >= 0xd800 && codePoint <= 0xdfff) return "\uFFFD";
	if (codePoint === 0xa0) return " ";
	return String.fromCodePoint(WINDOWS_1252.get(codePoint) ?? codePoint);
}

/**
 * Decodes a single reference such as `&amp;`, `&#39;` or `&#x27;`.
 * Returns `undefined` when it is not a complete, known reference.
 */
export function decodeHtmlEntity(reference: string): string | undefined {
	const match = /^&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]*));$/.exec(reference);
	if (!match) return undefined;
	return decodeMatch(match[1], match[2], match[3]);
}

function decodeMatch(decimal: string | undefined, hex: string | undefined, name: string | undefined): string | undefined {
	if (decimal !== undefined) return codePointText(Number.parseInt(decimal, 10));
	if (hex !== undefined) return codePointText(Number.parseInt(hex, 16));
	const codePoint = name === undefined ? undefined : NAMED.get(name);
	return codePoint === undefined ? undefined : codePointText(codePoint);
}

/** True when the text holds at least one reference this module would decode. */
export function hasHtmlEntity(text: string): boolean {
	if (!text.includes("&")) return false;
	for (const match of text.matchAll(REFERENCE)) {
		if (decodeMatch(match[1], match[2], match[3]) !== undefined) return true;
	}
	return false;
}

/**
 * Offset where a URL starts inside a delimiter-free token, or -1. A token with
 * a query string (`?` then `=`) is a relative URL from its last `( ) [ ] =`
 * before the `?`: markdown link text (`[Q&amp;A](/a?b=1)`) stays prose.
 */
function urlStart(token: string): number {
	let start = URL_START.exec(token)?.index ?? -1;
	const query = token.indexOf("?");
	if (query !== -1 && token.indexOf("=", query + 1) !== -1) {
		let from = query;
		while (from > 0 && !"()[]=".includes(token.charAt(from - 1))) from--;
		if (start === -1 || from < start) start = from;
	}
	return start;
}

/** Linear: split on URL delimiters, decode delimiters and prose, keep each URL tail verbatim. */
function decodeOutsideUrls(text: string, transform: DecodeHtmlEntitiesOptions["transform"]): string {
	return text
		.split(URL_DELIMITER)
		.map((piece, index) => {
			if (index % 2 === 1 || !piece.includes("&")) return decodeSegment(piece, transform);
			const start = urlStart(piece);
			return start === -1 ? decodeSegment(piece, transform) : decodeSegment(piece.slice(0, start), transform) + piece.slice(start);
		})
		.join("");
}

/**
 * Inline code spans of one line as [start, end) offsets: a run of n backticks
 * closes at the next run of exactly n (CommonMark). Linear in the line length.
 */
function inlineCodeSpans(line: string): [number, number][] {
	const runs = [...line.matchAll(/`+/g)].map((match) => ({ start: match.index ?? 0, length: match[0].length }));
	const nextSameLength = Array.from({ length: runs.length }, () => -1);
	const lastSeen = new Map<number, number>();
	for (let index = runs.length - 1; index >= 0; index--) {
		const length = runs[index]?.length ?? 0;
		nextSameLength[index] = lastSeen.get(length) ?? -1;
		lastSeen.set(length, index);
	}
	const spans: [number, number][] = [];
	for (let index = 0; index < runs.length; index++) {
		const close = nextSameLength[index] ?? -1;
		const open = runs[index];
		const closing = runs[close];
		if (close === -1 || !open || !closing) continue;
		spans.push([open.start, closing.start + closing.length]);
		index = close;
	}
	return spans;
}

function decodeSegment(text: string, transform: DecodeHtmlEntitiesOptions["transform"]): string {
	if (!text.includes("&")) return text;
	return text.replace(REFERENCE, (reference: string, decimal?: string, hex?: string, name?: string) => {
		const decoded = decodeMatch(decimal, hex, name);
		if (decoded === undefined) return reference;
		return transform ? transform(decoded, reference) : decoded;
	});
}

/** Decodes one level of HTML character references in plain text. */
export function decodeHtmlEntities(input: string, options: DecodeHtmlEntitiesOptions = {}): string {
	if (!input.includes("&")) return input;
	return options.preserveUrls ? decodeOutsideUrls(input, options.transform) : decodeSegment(input, options.transform);
}

/**
 * Markdown-aware variant: fenced code blocks (``` / ~~~) and inline code spans
 * are left verbatim — a reference inside code is literal text. Indented code
 * blocks are not detected (the crawled corpus never uses them).
 */
export function decodeHtmlEntitiesInMarkdown(markdown: string, options: DecodeHtmlEntitiesOptions = {}): string {
	if (!markdown.includes("&")) return markdown;
	let fence: { char: string; length: number } | null = null;
	return markdown
		.split("\n")
		.map((line) => {
			const marker = FENCE.exec(line)?.[1];
			if (fence) {
				const closes =
					marker !== undefined &&
					marker.charAt(0) === fence.char &&
					marker.length >= fence.length &&
					line.slice(line.indexOf(marker) + marker.length).trim() === "";
				if (closes) fence = null;
				return line;
			}
			if (marker !== undefined) {
				fence = { char: marker.charAt(0), length: marker.length };
				return line;
			}
			if (!line.includes("&")) return line;
			let out = "";
			let cursor = 0;
			for (const [start, end] of inlineCodeSpans(line)) {
				out += decodeHtmlEntities(line.slice(cursor, start), options) + line.slice(start, end);
				cursor = end;
			}
			return out + decodeHtmlEntities(line.slice(cursor), options);
		})
		.join("\n");
}
