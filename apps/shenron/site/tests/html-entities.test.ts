import { describe, expect, test } from "bun:test";
import {
	HTML_ENTITY_SQL_PATTERN,
	decodeHtmlEntities,
	decodeHtmlEntitiesInMarkdown,
	decodeHtmlEntity,
	hasHtmlEntity,
} from "../src/lib/text/html-entities";

describe("decodeHtmlEntities — production titles", () => {
	test.each([
		["Kanzenshuu - the perfect Dragon Ball database &amp; community!", "Kanzenshuu - the perfect Dragon Ball database & community!"],
		[
			"Press Archive | Shonen Jump (July 2003): &quot;The Legacy Continues on GBA…&quot;",
			'Press Archive | Shonen Jump (July 2003): "The Legacy Continues on GBA…"',
		],
		["DBFR — Le voyage dans l&#x27;univers Dragon Ball", "DBFR — Le voyage dans l'univers Dragon Ball"],
		[
			"Translations | V-Jump (June 2022) – &quot;Back-Up Comic: Victory Asada&#039;s Road Toward Super Top-Class!!!&quot; Chapter 35",
			'Translations | V-Jump (June 2022) – "Back-Up Comic: Victory Asada\'s Road Toward Super Top-Class!!!" Chapter 35',
		],
		["Episode #0542 (06 September 2026) &bull; Kanzenshuu", "Episode #0542 (06 September 2026) • Kanzenshuu"],
		["Tour Karin — Lieux &amp; Sanctuaires — DBFR", "Tour Karin — Lieux & Sanctuaires — DBFR"],
		["「パン-GT-&amp;ギル」S.H.Figuarts", "「パン-GT-&ギル」S.H.Figuarts"],
		["1989&#8211;1996 &ldquo;Z&rdquo; — Pok&eacute;mon", "1989–1996 “Z” — Pokémon"],
	])("%s", (input, expected) => {
		expect(decodeHtmlEntities(input)).toBe(expected);
	});
});

describe("decodeHtmlEntities — semantics", () => {
	test("decodes named, decimal and hexadecimal references", () => {
		expect(decodeHtmlEntities("&lt;b&gt; &#65;&#x42;&#X43; &eacute;&Eacute; &hellip;")).toBe("<b> ABC éÉ …");
	});

	test("decodes exactly one level per call", () => {
		expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
		expect(decodeHtmlEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
		expect(decodeHtmlEntities(decodeHtmlEntities("&amp;quot;"))).toBe('"');
	});

	test("is a fixed point on text without references", () => {
		const clean = "Goku & Vegeta — 100 % « Saiyan » ; R&D; a&b;c";
		expect(decodeHtmlEntities(clean)).toBe(clean);
		const once = decodeHtmlEntities("Q&amp;A &quot;DBZ&quot; l&#x27;arc");
		expect(decodeHtmlEntities(once)).toBe(once);
	});

	test("leaves unknown names and prototype keys intact", () => {
		for (const unknown of ["&Peace;", "&nK;", "&M;", "&w;", "&Lit;", "&foo;", "&constructor;", "&toString;", "&__proto__;", "&Amp;"]) {
			expect(decodeHtmlEntities(`x ${unknown} y`)).toBe(`x ${unknown} y`);
			expect(decodeHtmlEntity(unknown)).toBeUndefined();
		}
	});

	test("requires the terminating semicolon", () => {
		expect(decodeHtmlEntities("?a=1&copy=2&amp")).toBe("?a=1&copy=2&amp");
		expect(decodeHtmlEntities("&#39 &#x27")).toBe("&#39 &#x27");
	});

	test("maps every no-break space reference to a regular space", () => {
		expect(decodeHtmlEntities("a&nbsp;b&#160;c&#xA0;d&NonBreakingSpace;e")).toBe("a b c d e");
	});

	test("follows the WHATWG numeric rules", () => {
		expect(decodeHtmlEntities("&#146;&#150;&#128;&#x93;&#x94;")).toBe("’–€“”");
		expect(decodeHtmlEntities("&#0;|&#xD800;|&#x110000;|&#99999999999999999999;")).toBe("\uFFFD|\uFFFD|\uFFFD|\uFFFD");
		expect(decodeHtmlEntities("&#x1F409;&#128009;")).toBe("🐉🐉");
		expect(decodeHtmlEntities("&#x81;")).toBe("\u0081");
	});

	test("never produces a NUL byte (PostgreSQL text rejects it)", () => {
		expect(decodeHtmlEntities("&#0;&#x0;&#x00;")).not.toContain("\0");
	});

	test("covers the Latin-1 block in order", () => {
		expect(decodeHtmlEntity("&nbsp;")).toBe(" ");
		expect(decodeHtmlEntity("&iexcl;")).toBe("¡");
		expect(decodeHtmlEntity("&times;")).toBe("×");
		expect(decodeHtmlEntity("&szlig;")).toBe("ß");
		expect(decodeHtmlEntity("&divide;")).toBe("÷");
		expect(decodeHtmlEntity("&yuml;")).toBe("ÿ");
		expect(decodeHtmlEntity("&frac12;")).toBe("½");
		expect(decodeHtmlEntity("&sup2;")).toBe("²");
	});

	test("covers Greek, arrows and typography", () => {
		expect(decodeHtmlEntities("&Omega;&omega;&sigmaf;&Sigma;&Rho;")).toBe("ΩωςΣΡ");
		expect(decodeHtmlEntities("&larr;&rarr;&hArr;&lceil;&rfloor;")).toBe("←→⇔⌈⌋");
		expect(decodeHtmlEntities("&lsquo;&rsquo;&sbquo;&laquo;&raquo;&ndash;&mdash;&trade;&euro;&apos;")).toBe("‘’‚«»–—™€'");
		expect(decodeHtmlEntities("&AMP;&LT;&GT;&QUOT;")).toBe('&<>"');
	});

	test("preserveUrls keeps URLs byte for byte, up to an escaped delimiter", () => {
		const text = "Voir https://ja.wikipedia.org/wiki/Expo&amp;Linimo.jpg &amp; http://x.test/?a=1&amp;b=&quot;2 puis &quot;fin&quot;";
		expect(decodeHtmlEntities(text, { preserveUrls: true })).toBe(
			'Voir https://ja.wikipedia.org/wiki/Expo&amp;Linimo.jpg & http://x.test/?a=1&amp;b="2 puis "fin"',
		);
		expect(decodeHtmlEntities(text)).toContain("Expo&Linimo.jpg");
	});

	test.each([
		// Protocol-relative and root-relative URLs found in production excerpts.
		[
			'src="//thumb.wikimedia.org/40px-Disambig.svg.png?utm_source=ja.wikipedia.org&amp;utm_campaign=parser" alt=&quot;x&quot;',
			'src="//thumb.wikimedia.org/40px-Disambig.svg.png?utm_source=ja.wikipedia.org&amp;utm_campaign=parser" alt="x"',
		],
		[
			'srcset="/_next/image?url=https%3A%2F%2Fcdn.dragonballfr.com%2F13.webp&amp;w=64&amp;q=70 1x" l&#x27;affiche',
			'srcset="/_next/image?url=https%3A%2F%2Fcdn.dragonballfr.com%2F13.webp&amp;w=64&amp;q=70 1x" l\'affiche',
		],
		// Escaped HTML: the escaped quote ends the URL, `&amp;` stays inside it.
		["src=&quot;/a?b=1&amp;c=2&quot; &amp; fin", 'src="/a?b=1&amp;c=2" & fin'],
		["&lt;a href=&quot;https://x.test/?a=1&amp;b=2&quot;&gt;Q&amp;A&lt;/a&gt;", '<a href="https://x.test/?a=1&amp;b=2">Q&A</a>'],
		// Markdown link text stays decodable, its destination does not.
		["[Q&amp;A](https://x.test/?a=1&amp;b=2) [R&amp;D](/wiki?a=1&amp;b=2)", "[Q&A](https://x.test/?a=1&amp;b=2) [R&D](/wiki?a=1&amp;b=2)"],
		["www.x.test/?a=1&amp;b=2 page.php?id=1&amp;x=2", "www.x.test/?a=1&amp;b=2 page.php?id=1&amp;x=2"],
		// A question mark in prose is not a query string.
		["Pourquoi&nbsp;? Q&amp;A = oui", "Pourquoi ? Q&A = oui"],
	])("preserveUrls: %s", (input, expected) => {
		expect(decodeHtmlEntities(input, { preserveUrls: true })).toBe(expected);
	});

	test("preserveUrls stays linear on long unbroken tokens", () => {
		const hostile = `${"?".repeat(20_000)}${"&amp;".repeat(20_000)}${"a;".repeat(20_000)}${"a.".repeat(20_000)}=`;
		const started = performance.now();
		decodeHtmlEntities(hostile, { preserveUrls: true });
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	test("transform receives each decoded reference", () => {
		const seen: string[] = [];
		const out = decodeHtmlEntities("&lt;b&gt; &amp; &foo;", {
			transform: (decoded, reference) => {
				seen.push(reference);
				return decoded === "<" || decoded === ">" ? "" : decoded;
			},
		});
		expect(out).toBe("b & &foo;");
		expect(seen).toEqual(["&lt;", "&gt;", "&amp;"]);
	});
});

describe("decodeHtmlEntitiesInMarkdown", () => {
	test("leaves fenced code blocks and inline code verbatim", () => {
		const markdown = [
			"# Q&amp;A",
			"",
			"Texte &quot;cité&quot; et `code &amp; brut` puis ``a `&lt;` b``.",
			"```html",
			"<p>&amp;</p>",
			"```",
			"~~~~",
			"&copy;",
			"```",
			"toujours &copy;",
			"~~~~",
			"Après &hellip;",
		].join("\n");
		expect(decodeHtmlEntitiesInMarkdown(markdown)).toBe(
			[
				"# Q&A",
				"",
				'Texte "cité" et `code &amp; brut` puis ``a `&lt;` b``.',
				"```html",
				"<p>&amp;</p>",
				"```",
				"~~~~",
				"&copy;",
				"```",
				"toujours &copy;",
				"~~~~",
				"Après …",
			].join("\n"),
		);
	});

	test("stays linear on backtick-heavy lines", () => {
		const hostile = `${"`".repeat(10_000)} &amp; ${"` `` ".repeat(5_000)}&amp;`;
		const started = performance.now();
		decodeHtmlEntitiesInMarkdown(hostile, { preserveUrls: true });
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	test("an unclosed backtick is not a code span", () => {
		expect(decodeHtmlEntitiesInMarkdown("un ` seul &amp; point")).toBe("un ` seul & point");
	});

	test("keeps CRLF line endings and URLs", () => {
		expect(decodeHtmlEntitiesInMarkdown("a &amp; b\r\n- https://x.test/?q=1&amp;r=2\r\n", { preserveUrls: true })).toBe(
			"a & b\r\n- https://x.test/?q=1&amp;r=2\r\n",
		);
	});
});

describe("hasHtmlEntity and the SQL pattern", () => {
	test("only reports decodable references", () => {
		expect(hasHtmlEntity("a &amp; b")).toBe(true);
		expect(hasHtmlEntity("a &#x27; b")).toBe(true);
		expect(hasHtmlEntity("a &Peace; b")).toBe(false);
		expect(hasHtmlEntity("R&D, a & b")).toBe(false);
	});

	test("the SQL pattern selects a superset of what the decoder changes", () => {
		const pattern = new RegExp(HTML_ENTITY_SQL_PATTERN);
		for (const sample of ["&amp;", "&#39;", "&#x27;", "&frac12;", "&Peace;"]) expect(pattern.test(sample)).toBe(true);
		for (const sample of ["&amp", "& amp;", "&#;", "&#x;"]) expect(pattern.test(sample)).toBe(false);
	});
});
