import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const APP_DIR = join(import.meta.dir, "..", "src", "app");
const KIT_DIR = join(import.meta.dir, "..", "src", "components", "kit");
/** Toutes les `page.tsx` sous `src/app`, en chemins relatifs à `src/app`. */
function pages(dir = APP_DIR): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...pages(full));
			continue;
		}
		if (entry === "page.tsx") out.push(relative(APP_DIR, full).replaceAll("\\", "/"));
	}
	return out;
}
/**
 * Conteneur de page écrit à la main = centrage + largeur maximale + **gouttière
 * horizontale**, sur le même élément. C'est cette combinaison qui a produit
 * quatre largeurs et trois rythmes verticaux sur le site.
 *
 * Les trois conditions sont exigées ensemble, et les petites largeurs
 * (`max-w-sm|md|lg|xs`) sont écartées : un bloc centré SANS gouttière est une
 * colonne de lecture interne (le corps d'un article), et une carte de 28rem
 * centrée au milieu d'une page n'est pas un conteneur de page.
 */
function declaresPageContainer(source: string): boolean {
	// Chaque littéral de classes, un par un : exiger les trois marqueurs dans le
	// fichier entier produirait des faux positifs dès qu'une page a un `px-` ici
	// et un `mx-auto max-w-` trente lignes plus loin.
	const classLists = source.match(/className=(?:"[^"]*"|'[^']*'|\{`[^`]*`\})/g) ?? [];
	return classLists.some((list) => {
		if (!list.includes("mx-auto")) return false;
		if (!/\bp[xl]?-\[?[\w.]/.test(list)) return false;
		const width = list.match(/max-w-(\[[^\]]+\]|[\w]+)/);
		if (!width) return false;
		return !["xs", "sm", "md", "lg"].includes(width[1] ?? "");
	});
}
/**
 * Dette CONNUE : pages antérieures au kit qui déclarent encore leur propre
 * conteneur. Cette liste ne doit que DIMINUER — elle est là pour qu'une
 * nouvelle page ne puisse pas en ajouter une de plus sans que le test le dise.
 *
 * Les écrans `/admin/*` sont hors périmètre : ce sont des tableaux de bord
 * larges, souvent pleine page, et aucun visiteur ne navigue entre l'un d'eux et
 * une page publique dans la même session de lecture.
 */
const LEGACY_CONTAINERS = new Set([
	"dashboard/page.tsx",
	"parametres/page.tsx",
	"profil/[id]/page.tsx",
	"tierlists/creer/page.tsx",
	"tierlists/[slug]/page.tsx",
	"wiki/episodes/[id]/page.tsx",
	"wiki-bientot/page.tsx",
]);
describe("système de design — un seul vocabulaire", () => {
	test("aucune NOUVELLE page ne déclare son propre conteneur", () => {
		const offenders: string[] = [];
		for (const page of pages()) {
			if (page.startsWith("admin/")) continue;
			if (LEGACY_CONTAINERS.has(page)) continue;
			const src = readFileSync(join(APP_DIR, page), "utf8");
			if (declaresPageContainer(src)) offenders.push(page);
		}
		if (offenders.length > 0) {
			throw new Error(
				`Conteneur écrit à la main dans : ${offenders.join(", ")}\n` +
					"Utilise <PageShell> (components/kit) — ou ajoute la page à LEGACY_CONTAINERS " +
					"si la migration est volontairement différée."
			);
		}
	});
	test("la dette de conteneurs ne grossit pas", () => {
		// Borne haute figée : un ajout à `LEGACY_CONTAINERS` fait échouer ce test,
		// ce qui force à en retirer une autre ligne (ou à assumer la décision).
		expect(LEGACY_CONTAINERS.size).toBeLessThanOrEqual(7);
	});
	test("la liste de dette dit la vérité", () => {
		// Deux dérives possibles, toutes deux rendraient la garde inutile : une page
		// supprimée qui reste listée (elle masquerait une régression si le chemin est
		// recréé), et une page déjà migrée qui reste listée (la liste ne rétrécit
		// plus, donc plus personne ne la regarde).
		const present = new Set(pages());
		for (const page of LEGACY_CONTAINERS) {
			expect(present.has(page)).toBe(true);
			const src = readFileSync(join(APP_DIR, page), "utf8");
			if (!declaresPageContainer(src)) {
				throw new Error(
					`${page} n'a plus de conteneur écrit à la main : retire-la de LEGACY_CONTAINERS ` +
						"et baisse la borne du test précédent."
				);
			}
		}
	});
	/**
	 * Le kit est le vocabulaire commun : s'il perd une primitive, des pages vont
	 * la réinventer dans leur coin — c'est exactement ce qui a produit cinq cartes
	 * différentes.
	 */
	test("le kit expose ses primitives", () => {
		const barrel = readFileSync(join(KIT_DIR, "index.ts"), "utf8");
		for (const primitive of [
			"PageShell",
			"SectionHeading",
			"TabNav",
			"LinkPager",
			"MangaCard",
			"CardGrid",
			"EmptyState",
			"StatTiles",
			"Chip",
			"DomainBar",
			"PublicViewLink",
		]) {
			expect(barrel).toContain(primitive);
		}
	});
	/**
	 * Les titres de page ont UNE source (`HeroTitles`). Le kit doit s'y brancher,
	 * pas proposer une troisième typographie — le commentaire d'en-tête de
	 * `HeroTitles` raconte pourquoi : deux identités sur un site, c'est zéro.
	 */
	test("le titre de page du kit délègue à HeroTitles", () => {
		const heading = readFileSync(join(KIT_DIR, "SectionHeading.tsx"), "utf8");
		if (heading.includes("@shenron/ui/layout/SectionHeading")) {
			const uiHeading = readFileSync(join(REPO_ROOT, "packages", "shenron", "ui", "src", "layout", "SectionHeading.tsx"), "utf8");
			expect(uiHeading).toContain("HeroTitles");
		} else {
			expect(heading).toContain("HeroTitles");
		}
	});

	test("les index encyclopédiques d'expansion partagent leur coque wiki", () => {
		for (const page of ["combats", "dragons", "lieux", "musiques", "objets", "puissances", "tournois", "voix"]) {
			const src = readFileSync(join(APP_DIR, "wiki", page, "page.tsx"), "utf8");
			expect(src, `wiki/${page}`).toContain("WikiPageShell");
		}
	});

	test("les fiches d'expansion partagent la coque de leur index", () => {
		for (const page of ["combats", "lieux", "objets", "tournois", "voix"]) {
			const src = readFileSync(join(APP_DIR, "wiki", page, "[slug]", "page.tsx"), "utf8");
			expect(src, `wiki/${page}/[slug]`).toContain("WikiPageShell");
		}
	});

	test("les fiches d'expansion exposent le même point d'entrée de correction", () => {
		for (const [page, table] of [
			["combats", "db_battles"],
			["lieux", "db_locations"],
			["objets", "db_items"],
			["tournois", "db_tournaments"],
			["voix", "db_voice_actors"],
		]) {
			const src = readFileSync(join(APP_DIR, "wiki", page, "[slug]", "page.tsx"), "utf8");
			expect(src, `wiki/${page}/[slug]`).toContain(`WikiEditBar table="${table}"`);
		}
	});

	test("les index d'expansion exposent une invitation contributive", () => {
		for (const page of ["combats", "dragons", "lieux", "musiques", "objets", "puissances", "tournois", "voix"]) {
			const src = readFileSync(join(APP_DIR, "wiki", page, "page.tsx"), "utf8");
			expect(src, `wiki/${page}`).toContain("ContributeRail");
		}
	});

	test("la fiche épisode rejoint aussi le circuit de correction éditorial", () => {
		const src = readFileSync(join(APP_DIR, "wiki", "episodes", "[id]", "page.tsx"), "utf8");
		expect(src).toContain('WikiEditBar table="db_episodes"');
	});

	test("toutes les routes wiki héritent de la surface commune", () => {
		const layout = readFileSync(join(APP_DIR, "wiki", "layout.tsx"), "utf8");
		const css = readFileSync(join(APP_DIR, "globals.css"), "utf8");
		expect(layout).toContain("data-wiki-surface");
		if (css.includes("@shenron/ui/site.css")) {
			const uiCss = readFileSync(join(REPO_ROOT, "packages", "shenron", "ui", "src", "site.css"), "utf8");
			expect(uiCss).toContain("[data-wiki-surface]");
			expect(uiCss).toContain("--wiki-shell-max");
		} else {
			expect(css).toContain("[data-wiki-surface]");
			expect(css).toContain("--wiki-shell-max");
		}
	});
});
