/**
 * Pure helpers for translating English `sources-collectees/*` wiki pages into
 * French: language detection, main-content extraction from raw HTML, excerpt
 * cutting, translation validation and body rewriting.
 *
 * No I/O here — the remote Aphrody calls live in `_aphrody-translate-remote.ts`
 * and the CLI in `traduire-pages-collectees-aphrody.ts`. Pinned by
 * `apps/shenron/site/tests/collected-page-translation.test.ts`.
 */

// ── Language detection (stopword ratio) ───────────────────────────────────────

/** English function words; words shared with French (`on`, `a`, `as`…) are excluded. */
export const EN_STOPWORDS: ReadonlySet<string> = new Set(
	(
		"the and of to in is for with that this by from are was be at it an or you your we our they their " +
		"has have had not but all will can more new which who his her he she its into out about after before than " +
		"also been were if when what there other these those only over some would could should just up so no may " +
		"such how where then them most any each both through during while because being did does do my me us " +
		"him here very many much every first last one two three four five back now get got see use used like " +
		"between under again why off down own same few further once below above until against"
	).split(" "),
);

/** French function words; forms shared with English are excluded. */
export const FR_STOPWORDS: ReadonlySet<string> = new Set(
	(
		"le la les des du de un une et est dans pour sur par avec que qui ne pas plus au aux ce cette ces son sa " +
		"ses il elle ils elles sont été être ou mais leur leurs se nous vous lui tout tous toute toutes comme " +
		"était avait ont fait entre sans sous aussi très même où dont après avant chez deux trois premier première " +
		"quand été cet notre nos votre vos mon ma mes ton ta tes à ça peut ainsi alors encore puis selon vers"
	).split(" "),
);

export type LanguageStats = { words: number; en: number; fr: number };

const WORD = /[\p{L}][\p{L}'’-]*/gu;

export function languageStats(text: string): LanguageStats {
	let words = 0;
	let en = 0;
	let fr = 0;
	for (const [raw] of text.matchAll(WORD)) {
		let word = raw.toLowerCase();
		const elided = /^(?:[ldjmnstc]|qu)['’](.+)$/u.exec(word);
		if (elided?.[1]) {
			fr++;
			word = elided[1];
		}
		words++;
		if (EN_STOPWORDS.has(word)) en++;
		if (FR_STOPWORDS.has(word)) fr++;
	}
	return { words, en, fr };
}

/**
 * English prose (or English navigation text): enough English function words,
 * clearly outnumbering French ones. Titles alone rarely carry stopwords, so the
 * caller measures title + excerpt together.
 */
export function isEnglishText(text: string): boolean {
	const { words, en, fr } = languageStats(text);
	if (words < 4 || en < 2) return false;
	return en >= 2 * fr + 1 && en / words >= 0.06;
}

/** Share of English among recognised stopwords (0 when none is recognised). */
export function englishStopwordShare(text: string): number {
	const { en, fr } = languageStats(text);
	return en + fr === 0 ? 0 : en / (en + fr);
}

// ── HTML character references (one level, like an HTML parser) ─────────────────

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	middot: "·",
	bull: "•",
	copy: "©",
	reg: "®",
	trade: "™",
	times: "×",
	deg: "°",
	eacute: "é",
	egrave: "è",
	ecirc: "ê",
	agrave: "à",
	acirc: "â",
	ccedil: "ç",
	ocirc: "ô",
	ucirc: "û",
	ugrave: "ù",
	icirc: "î",
	iuml: "ï",
	euml: "ë",
	ouml: "ö",
	uuml: "ü",
	auml: "ä",
	oacute: "ó",
	aacute: "á",
	iacute: "í",
	uacute: "ú",
	ntilde: "ñ",
	Eacute: "É",
	shy: "",
	zwj: "",
	zwnj: "",
};

/** Decodes one level of HTML references; unknown names and malformed ones stay intact. */
export function decodeEntities(text: string): string {
	return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (reference, dec, hex, name) => {
		if (name !== undefined) return NAMED_ENTITIES[name] ?? reference;
		const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
		if (code === 0xa0) return " ";
		if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
		return String.fromCodePoint(code);
	});
}

// ── Markdown safety ───────────────────────────────────────────────────────────────

/** One-line text safe inside a markdown heading or paragraph (same policy as the crawler's `markdownText`). */
export function inlineMarkdown(value: string): string {
	return value
		.replace(/[\r\n]+/g, " ")
		.replace(/[\\`*_{}[\]<>]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Multi-paragraph text: each paragraph made inline-safe, paragraphs separated by a blank line. */
export function paragraphsMarkdown(value: string): string {
	return value
		.split(/\n\s*\n/)
		.map((paragraph) => inlineMarkdown(paragraph).replace(/^(#+|>|-|\+|\d+[.)])\s/, (marker) => `​${marker}`))
		.filter(Boolean)
		.join("\n\n");
}

// ── Minimal HTML tree + main-content extraction ─────────────────────────────────

type HtmlNode = { tag: string; attrs: string; children: (HtmlNode | string)[]; parent: HtmlNode | null };

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT_TAGS = ["script", "style", "noscript", "template", "svg", "textarea", "iframe", "object", "canvas", "math"];
const SKIPPED_TAGS = new Set(["nav", "header", "footer", "aside", "form", "button", "select", "dialog", "figure", "picture", "video", "audio", "map", "menu"]);
const BLOCK_TAGS = new Set([
	"address", "article", "blockquote", "dd", "div", "dl", "dt", "fieldset", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6",
	"hr", "li", "main", "ol", "p", "pre", "section", "table", "tbody", "thead", "tfoot", "tr", "ul", "br", "center", "caption",
]);
const CELL_TAGS = new Set(["td", "th"]);
/** `p`/`li`/`dt`/`dd`/`tr`/`td`/`th`/`option` close implicitly when a sibling of the same kind opens. */
const IMPLIED_CLOSE: Record<string, string[]> = {
	p: ["p"],
	li: ["li"],
	dt: ["dt", "dd"],
	dd: ["dt", "dd"],
	tr: ["tr", "td", "th"],
	td: ["td", "th"],
	th: ["td", "th"],
	option: ["option"],
};
/** Class/id tokens of boilerplate containers (menus, share bars, pagination, comments…). */
const BOILERPLATE_TOKEN =
	/(?:^|[\s_-])(?:nav|navbar|navigation|menu|menus|breadcrumbs?|sidebar|footer|header|share|sharing|social|comments?|related|pagination|pg_nav|cookie|cookies|banner|advert|ads|sponsor|widget|subscribe|newsletter|login|search|mobile|skip|toc|tags|meta|byline-share|site-links|top-bar)(?:$|[\s_-])/i;

function attribute(attrs: string, name: string): string {
	const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
	return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function stripRawText(html: string): string {
	let out = html.replace(/<!--[\s\S]*?-->/g, " ");
	for (const tag of RAW_TEXT_TAGS) out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
	return out;
}

export function parseHtml(html: string): HtmlNode {
	const root: HtmlNode = { tag: "#root", attrs: "", children: [], parent: null };
	let current = root;
	const source = stripRawText(html);
	const TOKEN = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<![^>]*>|<\?[^>]*>/g;
	let last = 0;
	for (const match of source.matchAll(TOKEN)) {
		const index = match.index ?? 0;
		if (index > last) current.children.push(source.slice(last, index));
		last = index + match[0].length;
		const tagName = match[2]?.toLowerCase();
		if (!tagName) continue;
		if (match[1] === "/") {
			let node: HtmlNode | null = current;
			while (node && node.tag !== tagName) node = node.parent;
			if (node?.parent) current = node.parent;
			continue;
		}
		const implied = IMPLIED_CLOSE[tagName];
		if (implied && implied.includes(current.tag) && current.parent) current = current.parent;
		const node: HtmlNode = { tag: tagName, attrs: match[3] ?? "", children: [], parent: current };
		current.children.push(node);
		if (!VOID_TAGS.has(tagName) && !(match[3] ?? "").trim().endsWith("/")) current = node;
	}
	if (last < source.length) current.children.push(source.slice(last));
	return root;
}

function findFirst(node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): HtmlNode | null {
	for (const child of node.children) {
		if (typeof child === "string") continue;
		if (predicate(child)) return child;
		const found = findFirst(child, predicate);
		if (found) return found;
	}
	return null;
}

const CONTENT_CLASS = /(?:^|\s)(?:entry-content|post-content|article-content|article-body|articleBody|mw-parser-output|main-content|content-body|post-body|news-body|detail-body|text-body)(?:\s|$)/;

/** The main content container: `<main>`, then `<article>`, then a known content class, then `#content`, then `<body>`. */
export function mainContentNode(root: HtmlNode): HtmlNode {
	return (
		findFirst(root, (node) => node.tag === "main" || attribute(node.attrs, "role") === "main") ??
		findFirst(root, (node) => node.tag === "article") ??
		findFirst(root, (node) => CONTENT_CLASS.test(attribute(node.attrs, "class")) || attribute(node.attrs, "itemprop") === "articleBody") ??
		findFirst(root, (node) => ["content", "main", "main-content", "article"].includes(attribute(node.attrs, "id"))) ??
		findFirst(root, (node) => node.tag === "body") ??
		root
	);
}

export type TextBlock = { text: string; linkChars: number; heading: boolean };

function isBoilerplateNode(node: HtmlNode): boolean {
	if (SKIPPED_TAGS.has(node.tag)) return true;
	if (/(?:^|\s)hidden(?:\s|=|$)/i.test(node.attrs)) return true;
	if (/display\s*:\s*none/i.test(attribute(node.attrs, "style"))) return true;
	if (attribute(node.attrs, "aria-hidden") === "true") return true;
	const role = attribute(node.attrs, "role");
	if (["navigation", "banner", "contentinfo", "complementary", "search", "menu", "menubar"].includes(role)) return true;
	const marker = `${attribute(node.attrs, "class")} ${attribute(node.attrs, "id")}`;
	return BOILERPLATE_TOKEN.test(marker);
}

/** Text blocks of a subtree in document order, with the share of link text per block. */
export function textBlocks(node: HtmlNode): TextBlock[] {
	const blocks: TextBlock[] = [];
	let text = "";
	let linkChars = 0;
	let heading = false;
	const flush = () => {
		const clean = decodeEntities(text).replace(/\s+/g, " ").trim();
		if (clean) blocks.push({ text: clean, linkChars: Math.min(linkChars, clean.length), heading });
		text = "";
		linkChars = 0;
		heading = false;
	};
	const walk = (current: HtmlNode, inLink: boolean) => {
		for (const child of current.children) {
			if (typeof child === "string") {
				text += child;
				if (inLink) linkChars += decodeEntities(child).replace(/\s+/g, " ").trim().length;
				continue;
			}
			if (isBoilerplateNode(child)) continue;
			if (child.tag === "img") {
				continue;
			}
			const block = BLOCK_TAGS.has(child.tag);
			if (block) flush();
			if (CELL_TAGS.has(child.tag) && text.trim()) text += " · ";
			if (/^h[1-6]$/.test(child.tag)) heading = true;
			walk(child, inLink || child.tag === "a");
			if (block) flush();
			else if (CELL_TAGS.has(child.tag)) text += " ";
		}
	};
	walk(node, false);
	flush();
	return blocks;
}

const BOILERPLATE_TEXT = /^(?:page top|back to top|top|share|tweet|print|read more|continue reading|next|previous|prev|home|menu|close|search|login|log in|sign in|register|skip to content|advertisement|loading\.*|©.*|copyright.*)$/i;

/** Drops link-heavy, boilerplate and repeated blocks; keeps the order. */
export function cleanBlocks(blocks: TextBlock[]): TextBlock[] {
	const seen = new Set<string>();
	const out: TextBlock[] = [];
	for (const block of blocks) {
		const text = block.text.replace(/\s*·\s*$/, "").trim();
		if (text.length < 2) continue;
		if (BOILERPLATE_TEXT.test(text)) continue;
		if (block.linkChars / text.length > 0.5) continue;
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ ...block, text });
	}
	return out;
}

/** A prose block: a sentence-like run of words with English or French function words. */
export function isProse(text: string): boolean {
	const { words, en, fr } = languageStats(text);
	return words >= 8 && (en + fr) / words >= 0.15;
}

/** Meaningful article text: at least 30 words spread over prose blocks. */
export function isMeaningfulContent(blocks: TextBlock[]): boolean {
	const proseWords = blocks.filter((block) => isProse(block.text)).reduce((sum, block) => sum + languageStats(block.text).words, 0);
	return proseWords >= 30;
}

/** First ~`max` characters at paragraph boundaries; an oversized first paragraph is cut at a sentence end. */
export function cutExcerpt(paragraphs: string[], max = 1_200): string {
	const kept: string[] = [];
	let length = 0;
	for (const paragraph of paragraphs) {
		const addition = paragraph.length + (kept.length > 0 ? 2 : 0);
		if (length + addition <= max) {
			kept.push(paragraph);
			length += addition;
			continue;
		}
		if (kept.length === 0) {
			const window = paragraph.slice(0, max);
			const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
			const wordEnd = window.lastIndexOf(" ");
			const cut = sentenceEnd >= max * 0.4 ? sentenceEnd + 1 : wordEnd > 0 ? wordEnd : max;
			kept.push(`${window.slice(0, cut).trim()} …`);
		}
		break;
	}
	return kept.join("\n\n");
}

export type MainContent = { meaningful: boolean; excerpt: string; title: string };

/**
 * Main article text of a raw HTML document: the main container minus nav,
 * headers, footers, sidebars and link lists; then the first ~1,200 characters.
 * The excerpt starts at the first heading or prose block, so leftover
 * breadcrumbs and dates before the article are skipped.
 */
export function extractMainContent(html: string, max = 1_200): MainContent {
	const root = parseHtml(html);
	const titleNode = findFirst(root, (node) => node.tag === "title");
	const title = titleNode ? decodeEntities(titleNode.children.filter((child) => typeof child === "string").join(" ")).replace(/\s+/g, " ").trim() : "";
	const blocks = cleanBlocks(textBlocks(mainContentNode(root)));
	const meaningful = isMeaningfulContent(blocks);
	const start = blocks.findIndex((block) => block.heading || isProse(block.text));
	const paragraphs = (start === -1 ? blocks : blocks.slice(start)).map((block) => block.text);
	return { meaningful, excerpt: meaningful ? cutExcerpt(paragraphs, max) : "", title };
}

// ── Collected page body ─────────────────────────────────────────────────────────

export const EXCERPT_HEADING = "## Extrait collecté";
export const ORIGINAL_EXCERPT_HEADING = "## Extrait collecté (original, anglais)";
export const TRANSLATION_HEADING = "## Traduction française (automatique, moteur Aphrody)";
export const DOCUMENT_HEADING = "## Description du document";
export const TRANSLATION_NOTE = "> Traduction automatique à relire ; la source d'origine fait foi.";
export const PROVENANCE_HEADING = "## Provenance";
export const EDITORIAL_HEADING = "## Classement éditorial";
export const DISCLAIMER = "> Cette fiche décrit un document collecté. Elle ne constitue pas une assertion canonique.";

export type BodySections = { preamble: string; sections: { heading: string; content: string }[] };

/** Splits a markdown body on its `## ` headings (the preamble holds the `# ` title and the disclaimer). */
export function splitSections(body: string): BodySections {
	const normalized = body.replace(/\r\n/g, "\n");
	const parts = normalized.split(/^(?=## )/m);
	const preamble = parts[0]?.startsWith("## ") ? "" : (parts.shift() ?? "");
	return {
		preamble,
		sections: parts.map((part) => {
			const newline = part.indexOf("\n");
			const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
			return { heading, content: newline === -1 ? "" : part.slice(newline + 1).trim() };
		}),
	};
}

export function sectionContent(body: string, heading: string): string | null {
	return splitSections(body).sections.find((section) => section.heading === heading)?.content ?? null;
}

export function originUrl(body: string): string | null {
	return /^- \*\*Document d'origine :\*\* (\S+)\s*$/m.exec(body)?.[1] ?? null;
}

export function isTranslatedBody(body: string): boolean {
	const { sections } = splitSections(body);
	return sections.some((section) => section.heading === TRANSLATION_HEADING || section.heading === DOCUMENT_HEADING);
}

/**
 * The text whose language defines the page: the title plus, for an untouched
 * page, the collected excerpt; for a page this pipeline rewrote, its French
 * sections (the original English excerpt is kept on purpose and not counted).
 */
export function measuredText(title: string, body: string): string {
	const { sections } = splitSections(body);
	const pick = (heading: string) => sections.find((section) => section.heading === heading)?.content ?? "";
	if (isTranslatedBody(body)) return `${title}\n${pick(TRANSLATION_HEADING)}\n${pick(DOCUMENT_HEADING)}`;
	return `${title}\n${pick(EXCERPT_HEADING)}`;
}

export function isEnglishPage(title: string, body: string): boolean {
	return isEnglishText(decodeEntities(measuredText(title, body)));
}

// ── Candidate selection ─────────────────────────────────────────────────────────

/** English stopwords that are also frequent romaji particles or syllables (`Uchuu no Hou`, `Kimi to Boku`). */
const ROMAJI_AMBIGUOUS: ReadonlySet<string> = new Set(["no", "to", "wa", "ga", "de", "ni", "mo", "o", "e", "he", "ka", "na", "ya", "yo", "ne", "so", "do", "go", "me", "us", "be", "in", "an", "are", "one"]);

/** A title carrying at least one English function word that cannot be a romaji particle. */
export function hasEnglishTitleWord(title: string): boolean {
	const clean = decodeEntities(title).replace(/\s*·\s*Jimaku\s*$/i, "").toLowerCase();
	for (const [word] of clean.matchAll(WORD)) if (EN_STOPWORDS.has(word) && !ROMAJI_AMBIGUOUS.has(word)) return true;
	return false;
}

/** Share of kana/kanji among letters: a Japanese page listing a few English titles is not an English page. */
export function japaneseShare(text: string): number {
	const letters = text.match(/\p{L}/gu)?.length ?? 0;
	const japanese = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu)?.length ?? 0;
	return letters === 0 ? 0 : japanese / letters;
}

/** The crawler's own English stub for a media asset (`Asset BXC discovered from <url>`): not document text. */
const ASSET_STUB = /^Asset BXC discovered from\s/;

/**
 * Whether a collected page is an English document this pipeline must translate:
 * not already rewritten, English title + excerpt, not a media-asset stub, not a
 * Japanese page. A jimaku.cc file index, whose only text is its title,
 * qualifies when that title has a genuine English word (romaji-only titles
 * such as `Uchuu Senkan Yamato · Jimaku` have nothing to translate).
 */
export function isTranslationCandidate(title: string, body: string, url: string): { ok: true } | { ok: false; reason: string } {
	if (isTranslatedBody(body)) return { ok: false, reason: "déjà traduite" };
	const excerpt = decodeEntities(sectionContent(body, EXCERPT_HEADING) ?? "");
	if (!excerpt) return { ok: false, reason: "sans extrait" };
	if (ASSET_STUB.test(excerpt)) return { ok: false, reason: "média" };
	let host = "";
	try {
		host = new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return { ok: false, reason: "URL d'origine invalide" };
	}
	// A jimaku.cc index is a file list: its title is its only text.
	if (host === "jimaku.cc") return hasEnglishTitleWord(title) ? { ok: true } : { ok: false, reason: "titre jimaku sans anglais" };
	if (!isEnglishPage(title, body)) return { ok: false, reason: "pas en anglais" };
	if (japaneseShare(`${decodeEntities(title)}\n${excerpt}`) > 0.05) return { ok: false, reason: "japonais" };
	return { ok: true };
}

// ── Translation validation ──────────────────────────────────────────────────────

export type TranslationCheck = { ok: true } | { ok: false; reason: string };

const normalizeForCompare = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Rejects the silent failures of the translation backends: empty output, the
 * input echoed back (the `google` backend returns the original on HTTP 429),
 * output still mostly English, or a length far off the source.
 * `properName` accepts an identical output for a title without any English
 * function word (e.g. `Dragon Ball Z · Jimaku`).
 */
export function checkTranslation(source: string, output: string, options: { properName?: boolean } = {}): TranslationCheck {
	const trimmed = output.trim();
	if (!trimmed) return { ok: false, reason: "vide" };
	if (normalizeForCompare(trimmed) === normalizeForCompare(source)) {
		const { en } = languageStats(source);
		if (options.properName && en === 0) return { ok: true };
		return { ok: false, reason: "identique à la source" };
	}
	const stats = languageStats(trimmed);
	if (stats.en + stats.fr >= 3 && stats.en / (stats.en + stats.fr) > 0.5) return { ok: false, reason: "encore en anglais" };
	const ratio = trimmed.length / Math.max(1, source.trim().length);
	if (source.trim().length >= 40 && (ratio < 0.5 || ratio > 2.5)) return { ok: false, reason: `longueur incohérente (${ratio.toFixed(2)})` };
	return { ok: true };
}

// ── Translation chunks ──────────────────────────────────────────────────────────

/**
 * The `bxc` backend silently echoes any input longer than ~512 characters, and
 * any kana/kanji switches the CLI to its JP→FR mode (which merges paragraphs
 * and panics on long inputs). Excerpts are therefore sent in pieces of at most
 * `TRANSLATION_CHUNK_MAX` characters, Japanese-dominant paragraphs are kept
 * as they are (original titles), and the pieces are joined back in order.
 */
export const TRANSLATION_CHUNK_MAX = 450;

export type TranslationChunk = {
	text: string;
	/** `false` for a Japanese-dominant paragraph, kept verbatim. */
	translate: boolean;
	/** Separator placed before this chunk when joining (`""` for the first). */
	joiner: "" | "\n\n" | " ";
};

function splitLongParagraph(paragraph: string, max: number): string[] {
	const pieces: string[] = [];
	let rest = paragraph.trim();
	while (rest.length > max) {
		const window = rest.slice(0, max);
		const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf("; "));
		const wordEnd = window.lastIndexOf(" ");
		const cut = sentenceEnd >= max * 0.3 ? sentenceEnd + 1 : wordEnd > 0 ? wordEnd : max;
		pieces.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) pieces.push(rest);
	return pieces;
}

export function translationChunks(text: string, max = TRANSLATION_CHUNK_MAX): TranslationChunk[] {
	const chunks: TranslationChunk[] = [];
	let pending: string[] = [];
	let pendingLength = 0;
	const flush = () => {
		if (pending.length === 0) return;
		chunks.push({ text: pending.join("\n\n"), translate: true, joiner: chunks.length ? "\n\n" : "" });
		pending = [];
		pendingLength = 0;
	};
	for (const paragraph of text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
		const kana = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(paragraph);
		if (kana) {
			flush();
			const verbatim = japaneseShare(paragraph) > 0.3;
			splitLongParagraph(paragraph, max).forEach((piece, index) => {
				chunks.push({ text: piece, translate: !verbatim, joiner: chunks.length === 0 ? "" : index === 0 ? "\n\n" : " " });
			});
			continue;
		}
		if (paragraph.length > max) {
			flush();
			splitLongParagraph(paragraph, max).forEach((piece, index) => {
				chunks.push({ text: piece, translate: true, joiner: chunks.length === 0 ? "" : index === 0 ? "\n\n" : " " });
			});
			continue;
		}
		if (pendingLength + paragraph.length + 2 > max) flush();
		pending.push(paragraph);
		pendingLength += paragraph.length + 2;
	}
	flush();
	return chunks;
}

export function joinChunks(chunks: { text: string; joiner: string }[]): string {
	return chunks.map((chunk) => `${chunk.joiner}${chunk.text.trim()}`).join("");
}

// ── Body rewrite ────────────────────────────────────────────────────────────────

export type TranslatedPage = {
	frenchTitle: string;
	originalTitle: string;
	/** Clean English excerpt from the origin document; empty when none could be extracted. */
	excerpt: string;
	/** French translation of `excerpt`. */
	translation: string;
	/** Neutral French description of the document, used when no excerpt exists. */
	description: string;
};

/**
 * Rewrites a collected page: French title, original title kept, provenance and
 * editorial classification untouched, the junk excerpt replaced by the clean
 * original excerpt and its machine translation (or by a neutral description).
 */
export function renderTranslatedBody(body: string, page: TranslatedPage): string {
	const { sections } = splitSections(body);
	const provenance = sections.find((section) => section.heading === PROVENANCE_HEADING);
	const editorial = sections.find((section) => section.heading === EDITORIAL_HEADING);
	if (!provenance) throw new Error("Section « Provenance » absente : fiche non conforme au gabarit des sources collectées.");
	const lines = [
		`# ${inlineMarkdown(page.frenchTitle)}`,
		"",
		DISCLAIMER,
		"",
		`**Titre original :** ${inlineMarkdown(page.originalTitle)}`,
		"",
		PROVENANCE_HEADING,
		"",
		provenance.content,
		"",
	];
	if (page.excerpt && page.translation) {
		lines.push(ORIGINAL_EXCERPT_HEADING, "", paragraphsMarkdown(page.excerpt), "", TRANSLATION_HEADING, "", paragraphsMarkdown(page.translation), "", TRANSLATION_NOTE, "");
	} else {
		lines.push(DOCUMENT_HEADING, "", inlineMarkdown(page.description), "");
	}
	if (editorial) lines.push(EDITORIAL_HEADING, "", editorial.content, "");
	return `${lines.join("\n").trim()}\n`;
}

/**
 * Neutral French description for a document whose text could not be extracted; never invents content.
 * `reason`: `list` (a file index such as jimaku.cc), `empty` (the page was read but holds no prose),
 * `unreadable` (the page could not be re-read when translating).
 */
export function neutralDescription(url: string, frenchTitle: string, reason: "list" | "empty" | "unreadable" = "empty"): string {
	let host = "";
	try {
		host = new URL(url).hostname.replace(/^www\./, "");
	} catch {
		host = "site d'origine";
	}
	const subject = inlineMarkdown(frenchTitle);
	const note = "Titre traduit automatiquement (moteur Aphrody) ; la source d'origine fait foi.";
	if (reason === "list" || host === "jimaku.cc") {
		return `Fiche d'index du site ${host} (catalogue de fichiers de sous-titres) consacrée à « ${subject} ». Le document d'origine est une liste de fichiers sans texte rédigé : seuls son titre et sa provenance sont repris ici. ${note}`;
	}
	if (reason === "unreadable") {
		return `Page en anglais du site ${host} intitulée « ${subject} ». Le document d'origine n'a pas pu être relu au moment de la traduction : seuls son titre et sa provenance sont repris ici. ${note}`;
	}
	return `Page en anglais du site ${host} intitulée « ${subject} ». Aucun texte rédigé exploitable n'a pu en être extrait (page de navigation, de liste ou de médias) : seuls son titre et sa provenance sont repris ici. ${note}`;
}
