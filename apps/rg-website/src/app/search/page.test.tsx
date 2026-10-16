import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	BASES_PAR_DEFAUT,
	construireRequete,
	formaterLigne,
	type LigneBrute,
	type ResultatRecherche,
} from "@rosegriffon/search";

import { SearchPageContent } from "./search-page";

function sourceFor(table: string): string {
	const branch = [construireRequete("rg"), construireRequete("inagle")]
		.join("\nUNION ALL\n")
		.split("\nUNION ALL\n")
		.find((candidate) => candidate.includes(`FROM ${table}`));
	const index = branch?.match(/(\d+)::int AS source/)?.[1];
	if (index === undefined) throw new Error(`Missing search source ${table}`);
	return index;
}

const rows: LigneBrute[] = [
	{ detail: null, id: "article-axel", source: sourceFor("public.articles"), titre: "Article Axel" },
	{
		detail: "azalee",
		id: "article-wiki-axel",
		source: sourceFor("public.articles"),
		titre: "Chronique Wiki Axel",
	},
	{
		detail: null,
		id: "axel-blaze",
		source: sourceFor("public.inagle_characters"),
		titre: "Axel Blaze",
	},
	{
		detail: null,
		id: "keshin-axel",
		source: sourceFor("public.inagle_keshins_clean"),
		titre: "Esprit d'Axel",
	},
	{ detail: null, id: "clan-axel", source: sourceFor("achillea.clan"), titre: "Clan Axel" },
];

const searchFixture = async (): Promise<ResultatRecherche[]> =>
	rows
		.map((row) => formaterLigne(row, BASES_PAR_DEFAUT))
		.filter((result): result is ResultatRecherche => result !== null);

describe("/search", () => {
	test("rend des liens réels pour les trois domaines avec le moteur commun", async () => {
		const html = renderToStaticMarkup(
			await SearchPageContent({
				searchParams: Promise.resolve({ q: "axel" }),
				search: searchFixture,
			}),
		);
		expect(html).toContain("Article Axel");
		expect(html).toContain("Chronique Wiki Axel");
		expect(html).toContain("Axel Blaze");
		expect(html).toContain("Esprit d&#x27;Axel");
		expect(html).toContain("Clan Axel");
		expect(html).toContain("/wiki/chara/axel-blaze");
		expect(html).toContain("/wiki/aura/esprits-guerriers/keshin-axel");
		expect(html).toContain("/achillea/clans/clan-axel");
	});

	test("filtre un domaine sans masquer son nombre de résultats", async () => {
		const html = renderToStaticMarkup(
			await SearchPageContent({
				searchParams: Promise.resolve({ q: "axel", tab: "wiki" }),
				search: searchFixture,
			}),
		);
		expect(html).toContain("Axel Blaze");
		expect(html).toContain("Chronique Wiki Axel");
		expect(html).not.toContain("Article Axel");
		expect(html).not.toContain("Clan Axel");
		expect(html).toContain("Wiki Azalée (3)");
	});

	test("affiche une panne au lieu d'annoncer zéro résultat", async () => {
		const logError = console.error;
		console.error = mock(() => {});
		try {
			const html = renderToStaticMarkup(
				await SearchPageContent({
					searchParams: Promise.resolve({ q: "axel" }),
					search: async () => {
						throw new Error("database unavailable");
					},
				}),
			);
			expect(html).toContain("temporairement indisponible");
			expect(html).not.toContain("Aucun résultat trouvé");
		} finally {
			console.error = logError;
		}
	});
});
