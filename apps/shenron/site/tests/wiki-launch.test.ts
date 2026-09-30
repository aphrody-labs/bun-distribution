/**
 * Matrice d'accès des rubriques — la table de décision la plus sensible du site
 * (elle décide ce qu'un anonyme voit), et elle n'avait aucun test.
 *
 * On teste les fonctions PURES de `lib/wiki-launch.ts` (client-safe) : le proxy,
 * le sitemap et `GatedLink` s'appuient tous les trois dessus, donc une
 * régression ici se propage partout.
 */
import { describe, expect, test } from "bun:test";
import {
	ALWAYS_OPEN_KEYS,
	findEntry,
	isPathPublic,
	publicEntries,
	resolveAccess,
	type AccessSnapshot,
} from "../src/lib/wiki-launch";

const EMPTY: AccessSnapshot = { openKeys: [], access: {} };

describe("findEntry — préfixe le plus long", () => {
	test("une route détail est rattachée à sa rubrique", () => {
		expect(findEntry("/wiki/episodes/421")?.key).toBe("episodes");
		expect(findEntry("/wiki/films/battle-of-gods")?.key).toBe("films");
	});

	test("le préfixe le plus long gagne", () => {
		// `/wiki/dragon-ball/techniques` ne doit pas être capté par une entrée
		// plus courte qui partagerait le début du chemin.
		expect(findEntry("/wiki/dragon-ball/techniques/kamehameha")?.key).toBe("techniques");
	});

	test("un chemin hors registre ne renvoie rien", () => {
		expect(findEntry("/wiki/segment-inconnu")).toBeUndefined();
		expect(findEntry("/une-page-quelconque")).toBeUndefined();
	});
});

describe("resolveAccess", () => {
	test("une rubrique alwaysOpen ne peut pas être refermée", () => {
		for (const key of ALWAYS_OPEN_KEYS) {
			expect(
				resolveAccess(key, { openKeys: [], access: { [key]: { mode: "admin", roleIds: [] } } }).mode
			).toBe("public");
		}
	});

	test("une règle enregistrée prime sur le défaut", () => {
		expect(
			resolveAccess("personnages", {
				openKeys: ["personnages"],
				access: { personnages: { mode: "members", roleIds: [] } },
			}).mode
		).toBe("members");
	});

	test("sans règle, une catégorie wiki suit openKeys", () => {
		expect(resolveAccess("personnages", { openKeys: ["personnages"] }).mode).toBe("public");
		expect(resolveAccess("personnages", { openKeys: [] }).mode).toBe("admin");
	});
});

describe("isPathPublic", () => {
	test("ferme par défaut sous /wiki, ouvre ailleurs", () => {
		// Politique identique à celle du proxy : un segment /wiki inconnu est
		// fermé, une page hors wiki est publique.
		expect(isPathPublic("/wiki/segment-inconnu", EMPTY)).toBe(false);
		// `/wiki` exactement fait exception : c'est le sommaire (cf. le describe
		// « sommaire /wiki » plus bas).
		expect(isPathPublic("/wiki", EMPTY)).toBe(true);
		expect(isPathPublic("/credits", EMPTY)).toBe(true);
		expect(isPathPublic("/", EMPTY)).toBe(true);
	});

	test("les rubriques bêta restent ouvertes même sans configuration", () => {
		expect(isPathPublic("/wiki/episodes/1", EMPTY)).toBe(true);
		expect(isPathPublic("/wiki/films/x", EMPTY)).toBe(true);
		expect(isPathPublic("/wiki/manga/1", EMPTY)).toBe(true);
		expect(isPathPublic("/wiki/chronologie", EMPTY)).toBe(true);
	});

	test("`members` et `roles` ne valent pas public", () => {
		// Un lien ou une URL de sitemap ne doit être émis que pour du VRAI public :
		// une rubrique réservée aux connectés redirigerait un anonyme.
		const cfg: AccessSnapshot = {
			openKeys: ["personnages"],
			access: {
				personnages: { mode: "members", roleIds: [] },
				databooks: { mode: "roles", roleIds: ["1"] },
			},
		};
		expect(isPathPublic("/wiki/personnages", cfg)).toBe(false);
		expect(isPathPublic("/wiki/databooks/3", cfg)).toBe(false);
	});
});

describe("publicEntries", () => {
	test("ne renvoie que des rubriques réellement publiques", () => {
		const keys = publicEntries(EMPTY).map((e) => e.key);
		for (const k of ALWAYS_OPEN_KEYS) expect(keys).toContain(k);
		expect(keys).not.toContain("personnages");
	});
});

describe("sommaire /wiki", () => {
	const ferme = { openKeys: [], access: {} };

	test("le sommaire est public même quand toutes les rubriques sont fermées", () => {
		// Il ne montre que des liens vers des rubriques gardées chacune par la
		// sienne : le fermer renvoyait tout le monde vers le teaser.
		expect(isPathPublic("/wiki", ferme)).toBe(true);
	});

	test("mais il n'ouvre PAS ses enfants", () => {
		// Le piège d'une entrée de registre avec le préfixe `/wiki` : elle
		// capterait `/wiki/n-importe-quoi` par `startsWith`.
		expect(isPathPublic("/wiki/personnages", ferme)).toBe(false);
		expect(isPathPublic("/wiki/segment-inconnu", ferme)).toBe(false);
	});

	test("hors /wiki, une page sans entrée reste publique", () => {
		expect(isPathPublic("/credits", ferme)).toBe(true);
		expect(isPathPublic("/wikipedia-like", ferme)).toBe(true);
	});
});
