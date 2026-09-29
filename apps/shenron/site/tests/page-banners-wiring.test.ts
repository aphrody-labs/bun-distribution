/**
 * Contrat éditeur → rendu public des bannières.
 *
 * Un champ présent dans /admin/banners ne doit jamais être une commande
 * décorative : chaque clé de page doit être lue par la route publique annoncée.
 */
import { describe, expect, test } from "bun:test";
import { PAGE_HERO_KEYS } from "../src/lib/page-banners";

const routes: Record<(typeof PAGE_HERO_KEYS)[number], string> = {
	episodes: "../src/app/wiki/episodes/page.tsx",
	films: "../src/app/wiki/films/page.tsx",
	chronologie: "../src/app/wiki/chronologie/page.tsx",
	personnages: "../src/app/wiki/personnages/page.tsx",
	sagas: "../src/app/wiki/sagas/page.tsx",
	arcs: "../src/app/wiki/arcs/page.tsx",
	races: "../src/app/wiki/races/page.tsx",
	transformations: "../src/app/wiki/transformations/page.tsx",
	techniques: "../src/app/wiki/techniques/page.tsx",
	jeux: "../src/app/wiki/jeux/page.tsx",
	manga: "../src/app/wiki/manga/page.tsx",
	databooks: "../src/app/wiki/databooks/page.tsx",
	combats: "../src/app/wiki/combats/page.tsx",
	dragons: "../src/app/wiki/dragons/page.tsx",
	lieux: "../src/app/wiki/lieux/page.tsx",
	musiques: "../src/app/wiki/musiques/page.tsx",
	objets: "../src/app/wiki/objets/page.tsx",
	puissances: "../src/app/wiki/puissances/page.tsx",
	tournois: "../src/app/wiki/tournois/page.tsx",
	voix: "../src/app/wiki/voix/page.tsx",
	news: "../src/app/news/page.tsx",
	tools: "../src/app/wiki/tools/page.tsx",
	romans: "../src/app/wiki/romans/page.tsx",
	staff: "../src/app/wiki/staff/page.tsx",
};

describe("bannières configurées dans l'administration", () => {
	test("chaque hero éditable est consommé par sa page publique", async () => {
		for (const key of PAGE_HERO_KEYS) {
			const source = await Bun.file(new URL(routes[key], import.meta.url)).text();
			expect(source).toContain('from "@/lib/banner-config"');
			expect(source).toContain(`pageHero("${key}")`);
		}
	});

	test("les aperçus série utilisent aussi la configuration PostgreSQL", async () => {
		const routes = [
			"../src/app/wiki/episodes/serie/[series]/page.tsx",
			"../src/app/wiki/episodes/@modal/(.)[id]/page.tsx",
			"../src/app/wiki/films/@modal/(.)[slug]/page.tsx",
		];
		for (const route of routes) {
			const source = await Bun.file(new URL(route, import.meta.url)).text();
			expect(source).toContain('from "@/lib/banner-config"');
			expect(source).toContain("await bannerForSeries(");
		}
	});

	test("une image éditoriale ne masque jamais une bannière explicitement configurée", async () => {
		const manga = await Bun.file(new URL("../src/app/wiki/manga/page.tsx", import.meta.url)).text();
		expect(manga).toContain('const heroImage = await pageHero("manga")');
		expect(manga).not.toContain("heroCover ?");

		for (const route of [
			"../src/app/wiki/episodes/serie/[series]/page.tsx",
			"../src/app/wiki/episodes/@modal/(.)[id]/page.tsx",
		]) {
			const source = await Bun.file(new URL(route, import.meta.url)).text();
			expect(source).toContain("backdrop={await bannerForSeries(");
			expect(source).not.toContain(".image ? assetUrl");
		}
	});
});
