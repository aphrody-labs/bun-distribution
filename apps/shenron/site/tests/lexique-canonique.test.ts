// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	chargerLexiqueCanonique,
	demasquerVocabulaire,
	masquerVocabulaire,
	verifierConformiteTraduction,
	verifierTexteSource,
} from "../src/lib/ja/lexique-canonique";

describe("Lexique Canonique & Masquage Dragon Ball", () => {
	test("charge le lexique canonique avec tri par longueur décroissante", () => {
		const lexique = chargerLexiqueCanonique();
		expect(lexique.length).toBeGreaterThan(10);

		// Vérifier que chaque élément est bien ordonné par longueur décroissante
		for (let i = 0; i < lexique.length - 1; i++) {
			expect(lexique[i]!.length).toBeGreaterThanOrEqual(lexique[i + 1]!.length);
		}
	});

	test("masque les termes du plus long au plus court sans laisser d'orphelins", () => {
		const texteJa = "ベジータは超サイヤ人のサイヤ人だ。孫悟空は界王拳と元気玉を使った。";
		const { texteMasque, termesTrouves, tokenMap } = masquerVocabulaire(texteJa);

		// Doit avoir trouvé Ultra / Super Saiyan avant Saiyan
		const jax = termesTrouves.map((t) => t.ja);
		expect(jax).toContain("超サイヤ人");
		expect(jax).toContain("サイヤ人");
		expect(jax).toContain("ベジータ");
		expect(jax).toContain("孫悟空");
		expect(jax).toContain("界王拳");
		expect(jax).toContain("元気玉");

		// Le texte masqué ne doit plus contenir les termes d'origine
		expect(texteMasque).not.toContain("超サイヤ人");
		expect(texteMasque).not.toContain("界王拳");
		expect(texteMasque).not.toContain("孫悟空");

		// Simulation de traduction : les tokens latins traversent le moteur
		const fauxTraduit = texteMasque
			.replace("を使った。", " a utilisé.")
			.replace("の", " des ")
			.replace("だ。", " est.")
			.replace("と", " et ");

		// Démasquage
		const texteFr = demasquerVocabulaire(fauxTraduit, tokenMap);
		expect(texteFr).toContain("Vegeta");
		expect(texteFr).toContain("Super Saiyan");
		expect(texteFr).toContain("Saiyan");
		expect(texteFr).toContain("Son Goku");
		expect(texteFr).toContain("Kaiô-ken");
		expect(texteFr).toContain("Genkidama");
	});

	test("gère les variantes d'imbrication (Kamehameha vs Super Kamehameha)", () => {
		const texteJa = "孫悟空の超かめはめ波とかめはめ波の威力。";
		const { texteMasque, tokenMap } = masquerVocabulaire(texteJa);

		// Super Kamehameha doit être masqué en premier en entier, ne laissant pas un '超' orphelin
		expect(texteMasque).not.toContain("超");
		expect(texteMasque).not.toContain("かめはめ波");

		const fauxTraduit = texteMasque.replace("の威力。", " puissance.");
		const texteFr = demasquerVocabulaire(fauxTraduit, tokenMap);

		expect(texteFr).toContain("Super Kamehameha");
		expect(texteFr).toContain("Kamehameha");
	});

	test("rejette les textes japonais corrompus avec verifierTexteSource", () => {
		// Texte avec idéogrammes simplifiés chinois
		const texteChinois = "孫悟空说这门很好。";
		const res = verifierTexteSource(texteChinois);
		expect(res.traduisible).toBe(false);
		expect(res.raison).toBe("chinois-simplifie");

		// Texte normal
		const texteOk = "孫悟空は修行を続けた。";
		expect(verifierTexteSource(texteOk).traduisible).toBe(true);
	});

	test("vérifie la conformité de la traduction française", () => {
		const ja = "孫悟空は界王拳を使った。";
		const frValide = "Son Goku a utilisé le Kaiô-ken (界王拳).";
		expect(verifierConformiteTraduction(frValide, ja).valide).toBe(true);

		// Sortie non traduite (100% japonais)
		const frJaponais = "孫悟空は界王拳を使った。";
		expect(verifierConformiteTraduction(frJaponais, ja).valide).toBe(false);
	});
});
