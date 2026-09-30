import { describe, expect, test } from "bun:test";
import { transcriptionsDe } from "../src/lib/databooks-index-shared";

/**
 * Le miroir Redis et son script de reconstruction lisent tous deux ces règles.
 * Une divergence entre les deux produirait un index reconstruit différent de
 * l'index tenu à jour au fil des dépôts, sans que rien ne le signale : ces cas
 * verrouillent la forme exacte du hash.
 */
describe("transcriptionsDe — ce que l'index porte réellement", () => {
	test("indexe la planche même sans transcription, sinon la lecture retombe en base", () => {
		const { champs, transcrites } = transcriptionsDe([
			{ number: 1, image: "a.jpg" },
			{ number: 2, image: "b.jpg", text: "孫悟空はカメハメ波を使った。" },
		]);
		expect(transcrites).toBe(1);
		// La planche muette est présente, valeur vide : `HMGET` la rend "" et non
		// `null`, donc le lot reste servi par l'index.
		expect(champs).toEqual(["1", "", "2", "孫悟空はカメハメ波を使った。"]);
	});

	test("accepte les DEUX formes de transcription du corpus", () => {
		// Deux passes de dépôt ont laissé la chaîne nue ET `{kind, markdown}`.
		const { champs, transcrites } = transcriptionsDe([
			{ number: 7, text: { kind: "text", markdown: "ベジータはサイヤ人の王子。" } },
		]);
		expect(transcrites).toBe(1);
		expect(champs).toEqual(["7", "ベジータはサイヤ人の王子。"]);
	});

	test("compte les planches fautives sans les écarter de l'index", () => {
		// Le corpus doit rester lisible tel qu'il est ; c'est le compte qui dit
		// au back-office ce qu'il reste à relire.
		const { transcrites, fautives } = transcriptionsDe([
			{ number: 1, text: "孫悟空は界王拳を使い、ベジータと戦った。ナメック星での出来事である。" },
			{ number: 2, text: "Привет мир, это не японский текст вовсе." },
		]);
		expect(transcrites).toBe(2);
		expect(fautives).toBe(1);
	});

	test("la traduction voyage dans un champ à part", () => {
		const { champs, traduites } = transcriptionsDe([
			{ number: 3, text: "界王拳", text_fr: "Kaïō-ken (界王拳)" },
		]);
		expect(traduites).toBe(1);
		expect(champs).toEqual(["3", "界王拳", "3:fr", "Kaïō-ken (界王拳)"]);
	});

	test("une planche sans numéro prend son rang, comme partout ailleurs", () => {
		const { champs } = transcriptionsDe([{ text: "あ".repeat(20) }, { number: null, text: "い" }]);
		expect(champs[0]).toBe("1");
		expect(champs[2]).toBe("2");
	});

	test("un jsonb rendu scalaire ne fait pas tomber l'indexation", () => {
		// Piège vécu sur `pages` : le driver a déjà écrit une chaîne là où un
		// tableau était attendu.
		expect(transcriptionsDe([]).champs).toEqual([]);
		expect(transcriptionsDe(["planche" as unknown]).champs).toEqual([]);
	});
});
