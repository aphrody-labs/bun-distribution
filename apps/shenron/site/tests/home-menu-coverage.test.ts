import { describe, expect, test } from "bun:test";
import {
	MOBILE_MENU_DESTINATIONS,
	MOBILE_MORE_DESTINATIONS,
	MOBILE_PRIMARY_DESTINATIONS,
} from "../src/lib/site-menu";
import { SITE_DESTINATIONS, destinationsOf } from "../src/lib/site-map";

const source = async (relative: string) => Bun.file(new URL(relative, import.meta.url)).text();

describe("accueil et menu complet", () => {
	test("le registre du menu ne contient aucun doublon", () => {
		const hrefs = MOBILE_MENU_DESTINATIONS.map((destination) => destination.href);
		expect(new Set(hrefs).size).toBe(Number(hrefs.length));
		expect(Number(MOBILE_MENU_DESTINATIONS.length)).toBe(
			Number(MOBILE_PRIMARY_DESTINATIONS.length + MOBILE_MORE_DESTINATIONS.length)
		);
	});

	/**
	 * Invariant réel : **aucune destination du menu n'est orpheline**.
	 *
	 * La version précédente exigeait une section d'accueil pour CHAQUE entrée du
	 * menu. C'était tenable quand la feuille « Plus » était une liste écrite à la
	 * main de dix entrées ; elle est maintenant dérivée de la carte du site
	 * (`lib/site-map.ts`), donc complète — et demander à la home un panneau pour
	 * les vingt-cinq destinations reviendrait à en faire un annuaire.
	 *
	 * Ce qui compte : chaque destination est atteignable par un chemin réel. Soit
	 * elle a sa section sur l'accueil, soit elle figure dans la carte du site —
	 * qui alimente à la fois `/plan-du-site` et les colonnes du pied de page,
	 * présentes sur toutes les pages.
	 */
	test("chaque destination du menu est atteignable (accueil ou carte du site)", async () => {
		const [page, catalog, journey, config] = await Promise.all([
			source("../src/app/page.tsx"),
			source("../src/components/stream/MediaCatalogRails.tsx"),
			source("../src/components/home/HomeMenuJourney.tsx"),
			source("../src/lib/home-scenes.ts"),
		]);
		const homepageSources = `${page}\n${catalog}\n${journey}\n${config}`;
		const mapped = new Set(SITE_DESTINATIONS.map((d) => d.href));

		for (const destination of MOBILE_MENU_DESTINATIONS) {
			if (destination.href === "/") {
				expect(page).toContain("<HomeExperience");
				continue;
			}
			const onHomepage = homepageSources.includes(`"${destination.href}"`);
			const inSiteMap = mapped.has(destination.href);
			if (!onHomepage && !inSiteMap) {
				throw new Error(
					`Destination orpheline : ${destination.href} n'a ni section d'accueil ni entrée dans lib/site-map.ts`
				);
			}
		}
	});

	test("la carte du site expose bien le plan et le pied de page le relaie", async () => {
		// `/plan-du-site` est le filet de sécurité de tout le reste : s'il sort de la
		// carte, plusieurs rubriques perdent leur seul lien entrant global.
		expect(SITE_DESTINATIONS.some((d) => d.href === "/plan-du-site")).toBe(true);

		// Le pied de page consomme la carte (et non plus trois colonnes figées) :
		// une rubrique ajoutée au registre y apparaît sans toucher au composant.
		const footer = await source("../src/components/SiteFooter.tsx");
		expect(footer).toContain("destinationsOf");

		// Chaque parcours de la carte porte au moins une destination : un parcours
		// vide signalerait un rattachement cassé entre registre et carte.
		for (const journey of ["decouvrir", "encyclopedie", "communaute", "legal"] as const) {
			expect(destinationsOf(journey).length).toBeGreaterThan(0);
		}
	});

	test("la barre mobile consomme le registre partagé", async () => {
		const navigation = await source("../src/components/BarreNavMobile.tsx");
		expect(navigation).toContain("MOBILE_PRIMARY_DESTINATIONS.map");
		expect(navigation).toContain("MOBILE_MORE_DESTINATIONS");
	});
});
