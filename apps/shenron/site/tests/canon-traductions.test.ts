/**
 * La mémoire de traduction des citations d'auteur
 * (`scripts/inventaires/canon-citations-fr.json`).
 *
 * Le corpus `.aphrody` vit hors du dépôt ; les traductions, elles, sont notre
 * travail et sont versionnées ici. Ce fichier est donc la seule chose qui
 * survive à une base réinitialisée — et il est réinjecté tel quel dans
 * `CanonConfig`. Ce qu'on vérifie : qu'il ne se dégrade pas silencieusement.
 *
 * Les graphies contrôlées ne sont pas des préférences de style : ce sont les
 * noms sous lesquels les fiches existent sur le site. Écrire « Freeza » envoie
 * le lecteur chercher une page qui n'existe pas.
 */
import { describe, expect, test } from "bun:test";

const memoire = (await Bun.file(
	new URL("../scripts/inventaires/canon-citations-fr.json", import.meta.url)
).json()) as { id: string; source: string; text: string; textFr: string }[];

const INTERDITS = [
	/\bFreeza\b/,
	/\bFrieza\b/,
	/\bKuririn\b/i,
	/\bKrillin\b/i,
	/\bSaiya-?jin\b/i,
	/\bSaiyen\b/i,
	/\bpoing du roi\b/i,
	/\bDragon Balls\b/,
];

describe("mémoire de traduction des citations", () => {
	test("chaque entrée porte un identifiant, un original et une traduction", () => {
		expect(memoire.length).toBeGreaterThan(0);
		for (const e of memoire) {
			expect(e.id).toBeTruthy();
			expect(e.text.trim()).toBeTruthy();
			expect(e.textFr.trim()).toBeTruthy();
			expect(e.textFr).not.toBe(e.text);
		}
	});

	test("aucune traduction ne garde de balise ni d'appel de note", () => {
		for (const e of memoire) {
			expect(e.textFr).not.toContain("<");
			expect(e.text).not.toContain("<");
		}
	});

	test("les graphies du wiki sont respectées", () => {
		const fautes = memoire
			.filter((e) => INTERDITS.some((r) => r.test(e.textFr)))
			.map((e) => e.id);
		expect(fautes).toEqual([]);
	});

	test("aucune traduction n'est un résumé ni une paraphrase enflée", () => {
		const suspects = memoire
			.filter((e) => {
				const ratio = e.textFr.length / Math.max(e.text.length, 1);
				return ratio < 0.5 || ratio > 2;
			})
			.map((e) => e.id);
		expect(suspects).toEqual([]);
	});

	test("les identifiants sont uniques", () => {
		expect(new Set(memoire.map((e) => e.id)).size).toBe(memoire.length);
	});
});
