/**
 * Navigation clavier des jeux d'onglets.
 *
 * Quatre des cinq `role="tablist"` du site n'écoutaient aucune touche : les
 * flèches ne faisaient rien, `Début`/`Fin` non plus. Ce test couvre la logique
 * de déplacement sans DOM réel — le helper ne dépend que de `querySelectorAll`,
 * de `document.activeElement` et de `focus()`/`click()`.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { onTablistKeyDown } from "../src/lib/tablist-keys";

interface FauxOnglet {
	selected: boolean;
	focused: boolean;
	clicked: number;
	getAttribute(nom: string): string | null;
	focus(): void;
	click(): void;
}

let onglets: FauxOnglet[] = [];
let empeche = 0;

const faireOnglet = (selected: boolean): FauxOnglet => {
	const o: FauxOnglet = {
		selected,
		focused: false,
		clicked: 0,
		getAttribute: (n) => (n === "aria-selected" ? String(o.selected) : null),
		focus() {
			for (const a of onglets) a.focused = false;
			o.focused = true;
			(globalThis as { document?: { activeElement: unknown } }).document = { activeElement: o };
		},
		click() {
			o.clicked += 1;
		},
	};
	return o;
};

const evenement = (key: string) =>
	({
		key,
		preventDefault: () => {
			empeche += 1;
		},
		currentTarget: { querySelectorAll: () => onglets },
	}) as unknown as Parameters<typeof onTablistKeyDown>[0];

const documentOrigine = (globalThis as { document?: unknown }).document;

beforeEach(() => {
	empeche = 0;
	onglets = [faireOnglet(true), faireOnglet(false), faireOnglet(false)];
	(globalThis as { document?: { activeElement: unknown } }).document = {
		activeElement: onglets[0],
	};
});

afterAll(() => {
	(globalThis as { document?: unknown }).document = documentOrigine;
});

/**
 * Retire commentaires de bloc, de ligne et commentaires JSX avant d'y chercher
 * un attribut. Sans ça, un fichier qui EXPLIQUE pourquoi il n'a plus de
 * `role="tab"` était compté comme s'il en portait un — c'est exactement ce qui
 * arrivait à `UniverseTabs.tsx`, dont l'en-tête raconte le retrait du jeu
 * d'onglets. Un test qui accuse la documentation d'un correctif finit par
 * pousser à effacer la documentation.
 */
function sansCommentaires(src: string): string {
	return src
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("onTablistKeyDown", () => {
	test("→ passe à l'onglet suivant et l'active", () => {
		onTablistKeyDown(evenement("ArrowRight"));
		expect(onglets[1]!.focused).toBe(true);
		expect(onglets[1]!.clicked).toBe(1);
		expect(empeche).toBe(1);
	});

	test("← boucle sur le dernier onglet", () => {
		onTablistKeyDown(evenement("ArrowLeft"));
		expect(onglets[2]!.focused).toBe(true);
	});

	test("↓ et ↑ se comportent comme → et ←", () => {
		onTablistKeyDown(evenement("ArrowDown"));
		expect(onglets[1]!.focused).toBe(true);
		onTablistKeyDown(evenement("ArrowUp"));
		expect(onglets[0]!.focused).toBe(true);
	});

	test("Début et Fin vont aux extrémités", () => {
		onTablistKeyDown(evenement("End"));
		expect(onglets[2]!.focused).toBe(true);
		onTablistKeyDown(evenement("Home"));
		expect(onglets[0]!.focused).toBe(true);
	});

	test("reprend depuis l'onglet sélectionné quand le focus est ailleurs", () => {
		// Cas réel : l'utilisateur a cliqué un onglet, le focus a bougé, puis il tabule.
		onglets[0]!.selected = false;
		onglets[2]!.selected = true;
		(globalThis as { document?: { activeElement: unknown } }).document = { activeElement: {} };
		onTablistKeyDown(evenement("ArrowRight"));
		expect(onglets[0]!.focused).toBe(true); // 2 → boucle → 0
	});

	test("ignore les touches hors périmètre", () => {
		onTablistKeyDown(evenement("a"));
		onTablistKeyDown(evenement("Tab"));
		onTablistKeyDown(evenement("Enter"));
		expect(empeche).toBe(0);
		expect(onglets.some((o) => o.clicked > 0)).toBe(false);
	});

	test("ne fait rien avec un seul onglet", () => {
		onglets = [faireOnglet(true)];
		onTablistKeyDown(evenement("ArrowRight"));
		expect(empeche).toBe(0);
		expect(onglets[0]!.clicked).toBe(0);
	});
});

describe("câblage des jeux d'onglets", () => {
	test("chaque tablist du site écoute le clavier", async () => {
		const { Glob } = await import("bun");
		const racine = fileURLToPath(new URL("../src/", import.meta.url));
		const muets: string[] = [];
		for await (const rel of new Glob("**/*.tsx").scan({ cwd: racine })) {
			const src = await Bun.file(`${racine}${rel}`).text();
			if (!src.includes('role="tablist"')) continue;
			if (!src.includes("onKeyDown")) muets.push(rel);
		}
		expect(muets).toEqual([]);
	});

	test('aucun role="tab" ne vit hors d\'un tablist', async () => {
		const { Glob } = await import("bun");
		const racine = fileURLToPath(new URL("../src/", import.meta.url));
		const orphelins: string[] = [];
		for await (const rel of new Glob("**/*.tsx").scan({ cwd: racine })) {
			const src = sansCommentaires(await Bun.file(`${racine}${rel}`).text());
			if (src.includes('role="tab"') && !src.includes('role="tablist"')) orphelins.push(rel);
		}
		expect(orphelins).toEqual([]);
	});
});
