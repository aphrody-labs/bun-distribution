import { describe, expect, it } from "bun:test";
import { cheminPlanche, texteDePlanche, traductionDePlanche } from "../scripts/_databooks-base";

describe("chemin de disque d'une planche", () => {
	// Le chemin stocké en base n'est PAS un chemin de disque : `serveAsset`
	// (apps/shenron/bot) route tout `assets/wiki/*` vers le `public/wiki/` du SITE. Un
	// contrôle mené depuis apps/shenron/bot déclarait 1 236 images manquantes alors
	// qu'aucune ne l'était.
	it("résout la forme stockée en base", () => {
		expect(cheminPlanche("./assets/wiki/databooks/abc.jpg")?.replaceAll("\\", "/")).toMatch(
			/apps\/site\/public\/wiki\/databooks\/abc\.jpg$/
		);
	});

	it("accepte les variantes d'écriture du chemin", () => {
		expect(cheminPlanche("assets/wiki/databooks/x.png")?.replaceAll("\\", "/")).toMatch(
			/public\/wiki\/databooks\/x\.png$/
		);
		expect(cheminPlanche("/assets/wiki/databooks/y.webp")?.replaceAll("\\", "/")).toMatch(
			/public\/wiki\/databooks\/y\.webp$/
		);
		expect(cheminPlanche("assets\\wiki\\databooks\\z.jpg")?.replaceAll("\\", "/")).toMatch(
			/public\/wiki\/databooks\/z\.jpg$/
		);
	});

	it("refuse ce qui n'est pas un chemin d'asset plutôt que d'inventer", () => {
		expect(cheminPlanche(null)).toBeNull();
		expect(cheminPlanche("")).toBeNull();
		expect(cheminPlanche("   ")).toBeNull();
		expect(cheminPlanche("https://exemple.test/x.jpg")).toBeNull();
	});
});

describe("lecture du texte d'une planche", () => {
	// Le corpus porte les DEUX formes : une chaîne brute pour les dépôts
	// anciens, `{kind,markdown}` pour les récents. Un consommateur qui n'en
	// connaît qu'une affiche « [object Object] » au lecteur.
	it("lit la forme chaîne comme la forme objet", () => {
		expect(texteDePlanche({ text: "かめはめ波" })).toBe("かめはめ波");
		expect(texteDePlanche({ text: { kind: "text", markdown: "## 界王拳" } })).toBe("## 界王拳");
	});

	it("rend une chaîne vide sur tout le reste, jamais `undefined`", () => {
		expect(texteDePlanche({})).toBe("");
		expect(texteDePlanche({ text: null })).toBe("");
		expect(texteDePlanche({ text: { kind: "none" } })).toBe("");
		expect(texteDePlanche(null)).toBe("");
		expect(texteDePlanche({ text: 42 })).toBe("");
	});

	it("lit la traduction sous les mêmes deux formes", () => {
		expect(traductionDePlanche({ text_fr: "Kaméhaméha" })).toBe("Kaméhaméha");
		expect(traductionDePlanche({ text_fr: { kind: "text", markdown: "Kaïō-ken" } })).toBe(
			"Kaïō-ken"
		);
		expect(traductionDePlanche({ text: "かめはめ波" })).toBe("");
	});
});
