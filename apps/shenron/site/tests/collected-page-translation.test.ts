import { describe, expect, test } from "bun:test";
import {
	DOCUMENT_HEADING,
	EDITORIAL_HEADING,
	ORIGINAL_EXCERPT_HEADING,
	PROVENANCE_HEADING,
	TRANSLATION_HEADING,
	checkTranslation,
	decodeEntities,
	extractMainContent,
	hasEnglishTitleWord,
	isTranslatedBody,
	isTranslationCandidate,
	neutralDescription,
	renderTranslatedBody,
	TRANSLATION_CHUNK_MAX,
	joinChunks,
	translationChunks,
} from "../scripts/_collected-page-translation";

const MENU =
	"Forum(/forum/) Wiki(/wiki/) - News(/index.php) - General Info - FAQs(/faqs/) PAGE TOP(#) If you're looking for the latest franchise news, we have you covered. And if you're in search of news from the past, be sure to check our archive.";

function collectedBody(title: string, url: string, excerpt: string): string {
	return [
		`# ${title}`,
		"",
		"> Cette fiche décrit un document collecté. Elle ne constitue pas une assertion canonique.",
		"",
		PROVENANCE_HEADING,
		"",
		"- **Type :** reference",
		"- **Statut HTTP observé :** 200",
		`- **Document d'origine :** ${url}`,
		"",
		"## Extrait collecté",
		"",
		excerpt,
		"",
		EDITORIAL_HEADING,
		"",
		"- **Rubrique :** Sources collectées — Interviews",
		"",
	].join("\n");
}

describe("sélection des fiches anglaises", () => {
	test("une page Kanzenshuu au menu anglais est candidate", () => {
		const title = "Home Video Guide | Japanese Releases | Dragon Box Z Volume 2";
		const url = "https://www.kanzenshuu.com/home-video/jp/dragon-box-z2/";
		expect(isTranslationCandidate(title, collectedBody(title, url, MENU), url)).toEqual({ ok: true });
	});

	test("un média, une page japonaise ou un titre jimaku en rōmaji sont écartés", () => {
		const asset = "Asset BXC discovered from https://www.kanzenshuu.com/2026/09/01/news/ and the rest of the page";
		expect(isTranslationCandidate("promo.jpg", collectedBody("promo.jpg", "https://www.kanzenshuu.com/a.jpg", asset), "https://www.kanzenshuu.com/a.jpg")).toMatchObject({ ok: false });
		expect(hasEnglishTitleWord("Uchuu no Hou: Reimei-hen · Jimaku")).toBe(false);
		expect(hasEnglishTitleWord("Tales of the Abyss · Jimaku")).toBe(true);
	});

	test("une fiche déjà réécrite n'est plus candidate", () => {
		const url = "https://www.kanzenshuu.com/x/";
		const body = renderTranslatedBody(collectedBody("About the site", url, MENU), {
			frenchTitle: "À propos du site",
			originalTitle: "About the site",
			excerpt: "",
			translation: "",
			description: neutralDescription(url, "À propos du site"),
		});
		expect(isTranslatedBody(body)).toBe(true);
		expect(isTranslationCandidate("À propos du site", body, url)).toMatchObject({ ok: false });
	});
});

describe("contenu principal et traduction", () => {
	test("le menu et le pied de page sont retirés, le texte d'article gardé", () => {
		const html = `<html><head><title>Guide &amp; FAQ</title></head><body><nav><a href="/forum/">Forum</a> <a href="/wiki/">Wiki</a></nav>
			<main><h1>What are the Dragon Boxes?</h1><p>Starting in 2003 and ending in 2005, Toei Animation, in cooperation with the DVD company Pony Canyon, released a series of four box sets covering the entire Dragon Ball TV series.</p>
			<p>In 2006, Toei Animation released all of the movies on their own in the fifth and final Dragon Box, which is still the reference for the franchise.</p></main>
			<footer>PAGE TOP</footer></body></html>`;
		const content = extractMainContent(html);
		expect(content.title).toBe("Guide & FAQ");
		expect(content.meaningful).toBe(true);
		expect(content.excerpt.startsWith("What are the Dragon Boxes?")).toBe(true);
		expect(content.excerpt).not.toContain("Forum");
		expect(content.excerpt).not.toContain("PAGE TOP");
	});

	test("l'extrait part en segments courts, le japonais reste tel quel", () => {
		const long = "Toei Animation released a series of box sets covering the entire series. ".repeat(10).trim();
		const excerpt = ["激突！！１００億パワーの戦士たち", "Gekitotsu!! Hyaku-Oku Pawā no Senshi-tachi", long, "General Information"].join("\n\n");
		const chunks = translationChunks(excerpt);
		expect(chunks.every((chunk) => chunk.text.length <= TRANSLATION_CHUNK_MAX)).toBe(true);
		expect(chunks[0]).toEqual({ text: "激突！！１００億パワーの戦士たち", translate: false, joiner: "" });
		expect(chunks.filter((chunk) => chunk.joiner === " ").length).toBeGreaterThan(0);
		expect(joinChunks(chunks)).toBe(excerpt);
	});

	test("une sortie identique à la source est un échec, sauf nom propre", () => {
		expect(checkTranslation("The latest news of the franchise", "The latest news of the franchise")).toMatchObject({ ok: false });
		expect(checkTranslation("K-ON! · Jimaku", "K-ON! · Jimaku", { properName: true })).toEqual({ ok: true });
		expect(checkTranslation("The latest news of the franchise", "Les dernières nouvelles de la franchise")).toEqual({ ok: true });
	});

	test("la réécriture garde Provenance et Classement, décode les entités", () => {
		const url = "https://www.kanzenshuu.com/guide/";
		const body = renderTranslatedBody(collectedBody("Guide", url, MENU), {
			frenchTitle: decodeEntities("Guide des boîtes &amp; coffrets"),
			originalTitle: decodeEntities("Box &amp; set guide"),
			excerpt: "Starting in 2003, Toei released four box sets.",
			translation: "À partir de 2003, Toei a publié quatre coffrets.",
			description: "",
		});
		expect(body.startsWith("# Guide des boîtes & coffrets\n")).toBe(true);
		expect(body).toContain("**Titre original :** Box & set guide");
		expect(body).toContain(`- **Document d'origine :** ${url}`);
		expect(body).toContain(ORIGINAL_EXCERPT_HEADING);
		expect(body).toContain(TRANSLATION_HEADING);
		expect(body).toContain("Traduction automatique à relire ; la source d'origine fait foi.");
		expect(body).toContain("- **Rubrique :** Sources collectées — Interviews");
		expect(body).not.toContain(DOCUMENT_HEADING);
		expect(body).not.toContain("PAGE TOP");
	});
});
