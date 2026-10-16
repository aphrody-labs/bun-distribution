import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	cheminsCliquables,
	construireAssociationItems,
	construireEsportItems,
	construireMobileNavUnifiee,
	construireNavigationUnifiee,
	domaineDeLaRoute,
	itemsDeNavigation,
} from "../src/config/navigation";
import { listerMotifsRoutes, motifAccepte, routeExiste } from "../src/lib/routes-next";

const RACINE = join(import.meta.dir, "../../../..");

const APP = join(RACINE, "apps/rg-website/src/app");

describe("motifAccepte", () => {
	test("segment littéral", () => {
		expect(motifAccepte("/chara", "/chara")).toBe(true);
		expect(motifAccepte("/chara", "/skill")).toBe(false);
		// Pas de correspondance par préfixe de chaîne.
		expect(motifAccepte("/mode", "/modeles")).toBe(false);
	});

	test("segment dynamique", () => {
		expect(motifAccepte("/chara/[id]", "/chara/c05028001")).toBe(true);
		expect(motifAccepte("/chara/[id]", "/chara")).toBe(false);
		expect(motifAccepte("/chara/[id]", "/chara/a/b")).toBe(false);
	});

	test("catch-all optionnel `[[...x]]` avale aussi le vide", () => {
		expect(motifAccepte("/modeles/[[...path]]", "/modeles")).toBe(true);
		expect(motifAccepte("/modeles/[[...path]]", "/modeles/a/b/c")).toBe(true);
	});

	test("catch-all obligatoire `[...x]` exige au moins un segment", () => {
		expect(motifAccepte("/docs/[...path]", "/docs")).toBe(false);
		expect(motifAccepte("/docs/[...path]", "/docs/a")).toBe(true);
	});

	test("ignore la query string", () => {
		expect(routeExiste(["/search"], "/search?q=axel")).toBe(true);
	});
});

describe("inventaire des routes", () => {
	test("l'arborescence app/ est lisible et non vide", () => {
		expect(existsSync(APP)).toBe(true);
		const motifs = listerMotifsRoutes(APP);
		expect(motifs.length).toBeGreaterThan(50);
		// Les route groups ne doivent jamais fuiter dans une URL.
		expect(motifs.filter((m) => m.includes("("))).toEqual([]);
	});
});

/**
 * Non-régression des liens du menu unifié.
 *
 * Un lien ajouté sans page fait échouer les tests, pas la production.
 */
describe("navigation unifiée : trois catégories", () => {
	test("sépare les projets RG des sous-routes de tournois Achilléa", () => {
		const projects = construireAssociationItems().find((item) => item.path === "/projets");
		const tournaments = construireEsportItems().find((item) => item.path === "/achillea/tournaments");
		const projectPaths = (projects?.children ?? []).map((item) => item.path);
		const tournamentPaths = (tournaments?.children ?? []).map((item) => item.path);

		expect(projectPaths).toContain("/projets/emotes");
		expect(projectPaths).toContain("/rose-griffon-tv");
		expect(projectPaths.some((path) => path.startsWith("/achillea/tournaments"))).toBe(false);
		expect(tournamentPaths).toEqual([
			"/achillea/tournaments",
			"/achillea/tournaments/create",
			"/achillea/tournaments/circuit/ranking",
		]);
	});

	test("les trois catégories sont présentes, dans l'ordre", () => {
		const groupes = construireNavigationUnifiee();
		expect(groupes.map((g) => g.domaine)).toEqual([
			"association",
			"wiki",
			"esport",
		]);
	});

	test("les entêtes de groupe ne sont pas des destinations", () => {
		for (const { item } of construireNavigationUnifiee()) {
			expect(item.groupOnly).toBe(true);
		}
	});

	test("chaque lien cliquable du menu unifié correspond à une route réelle", () => {
		const motifs = listerMotifsRoutes(APP);
		const items = itemsDeNavigation().flatMap((groupe) => groupe.children ?? []);
		const morts = cheminsCliquables(items).filter((chemin) => !routeExiste(motifs, chemin));
		expect(morts).toEqual([]);
	});

	test("chaque onglet de la barre mobile correspond à une route réelle", () => {
		const motifs = listerMotifsRoutes(APP);
		const morts = cheminsCliquables(construireMobileNavUnifiee()).filter(
			(chemin) => !routeExiste(motifs, chemin)
		);
		expect(morts).toEqual([]);
	});

	test("domaineDeLaRoute classe chaque route dans son domaine", () => {
		expect(domaineDeLaRoute("/achillea/clans")).toBe("esport");
		expect(domaineDeLaRoute("/wiki/chara")).toBe("wiki");
		expect(domaineDeLaRoute("/chroniques")).toBe("association");
		expect(domaineDeLaRoute("/")).toBe("association");
		// Piège du préfixe de chaîne : `/achilleaxyz` n'est pas dans `/achillea`.
		expect(domaineDeLaRoute("/achilleaxyz")).toBe("association");
	});
});
