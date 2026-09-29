/**
 * L'extraction du corpus `.aphrody` vers les citations de `/wiki/canon`.
 *
 * Trois formats cohabitent dans la base de connaissance locale, et aucun n'est
 * sous notre contrôle : les notes françaises curées (citations entre
 * guillemets), les guides traduits par Kanzenshuu (question puis réponse) et
 * les introductions des 42 tankōbon (une par tome, datée). Une dérive de format
 * ne casse rien visiblement — elle rend simplement zéro citation, et la page
 * de canonicité perd ses pièces à conviction sans le dire.
 *
 * Ces tests figent donc un échantillon de chaque format et vérifient qu'il
 * ressort avec sa source et son année.
 */
import { describe, expect, test } from "bun:test";
import { DOCUMENTS, PARSEURS, REFUSÉ, motsCles } from "../scripts/_aphrody-corpus";

const FR = `---
source_file: X
---

# Lore

## 🟢 Piccolo : Le Personnage Préféré de l'Auteur

Toriyama a toujours maintenu que Piccolo était son favori.

> « Je suppose que j'aime Piccolo le plus après tout... son passé de méchant le rend plus intéressant à développer que Goku. »
>
> _— Akira Toriyama, Daizenshuu 2 : Story Guide (1995)_

- **Rachat spirituel :** la relation mentor/élève avec Son Gohan comptait beaucoup pour l'auteur, qui y revient à chaque entretien publié.
`;

const GUIDE = `---
source_file: X
---

Dragon Ball Super Exciting Guide: Character Volume (03 April 2009)
----------

By the way, what’s Satan’s real name?

His real name is Mark. It comes from “akuma”, and Satan is his ring name. In the area where he lives, there are no family names at all, which is why nobody ever asks about it.

Why are characters’ names grouped into sets?

It’s tough coming up with names for a lot of characters. The Saiyans are vegetables, and the Ginyu Special-Squad are dairy products, like that.
`;

const TANKOBON = `---
source_file: X
---

[Dragon Ball Volume 01: Son Goku and Friends](/manga/tankobon/vol-01/) / (10 September 1985)

![](/guides/manga/tankobon/01/toriyama.jpg)The setting of *Dragon Ball* has a sort of Chinese feel to it, but it’s not necessarily limited to China. The overall story is very simple, but I’d like to make up the finer details as I go along.

[Dragon Ball Volume 02: A Critical Moment](/manga/tankobon/vol-02/) / (10 January 1986)

![](/guides/manga/tankobon/02/toriyama.jpg)Happy New Year. Which means that I, who made my debut at my 23rd New Year’s, have now come to my 30th. I’ve thoroughly managed to become a real cartoonist.
`;

describe("extraction du corpus .aphrody", () => {
	test("une citation française ressort avec son texte, sa source et son année", () => {
		const [citation] = PARSEURS.citations(FR);
		expect(citation).toBeDefined();
		expect(citation!.texte).toStartWith("Je suppose que j'aime Piccolo");
		// Les guillemets et l'attribution ne font pas partie de la citation.
		expect(citation!.texte).not.toContain("Akira Toriyama");
		expect(citation!.annee).toBe(1995);
		expect(citation!.precision).toContain("Daizenshuu 2");
		expect(citation!.sujet).toContain("Piccolo");
	});

	test("la synthèse d'une section ne recopie pas la citation qu'elle entoure", () => {
		const [fait] = PARSEURS.faits(FR);
		expect(fait).toBeDefined();
		expect(fait!.texte).not.toContain("Je suppose que j'aime Piccolo");
		expect(fait!.texte).toContain("mentor");
	});

	test("un guide Kanzenshuu rend une entrée par question", () => {
		const extraits = PARSEURS.sections(GUIDE);
		const satan = extraits.find((e) => e.sujet.includes("Satan"));
		expect(satan).toBeDefined();
		expect(satan!.texte).toContain("Mark");
		expect(extraits.some((e) => e.sujet.includes("grouped into sets"))).toBe(true);
	});

	test("les introductions de tankōbon sortent numérotées et datées", () => {
		const extraits = PARSEURS.tankobon(TANKOBON);
		expect(extraits).toHaveLength(2);
		expect(extraits[0]!.sujet).toBe("Tome 01 — Son Goku and Friends");
		expect(extraits[0]!.annee).toBe(1985);
		// L'image d'en-tête n'est pas du texte d'auteur.
		expect(extraits[0]!.texte).not.toContain("![](");
		expect(extraits[0]!.texte).toStartWith("The setting of Dragon Ball");
		expect(extraits[1]!.annee).toBe(1986);
	});
});

describe("mots-clés d'une citation", () => {
	const lexique = ["Son Goku", "Piccolo", "Long", "Apple"];

	test("les entités du wiki priment sur les mots du titre", () => {
		const cles = motsCles("Le Personnage Préféré", "Toriyama préfère Piccolo à Son Goku.", lexique);
		expect(cles[0]).toBe("son goku");
		expect(cles).toContain("piccolo");
		expect(cles).toContain("personnage");
	});

	test("un nom propre ne s'apparie pas à son homonyme commun en minuscule", () => {
		// « Long » et « Apple » sont des personnages ; « a long apple pie » n'en parle pas.
		const cles = motsCles("Recette", "It was a long apple pie, nothing more.", lexique);
		expect(cles).not.toContain("long");
		expect(cles).not.toContain("apple");
	});

	test("les mots vides ne deviennent jamais des mots-clés", () => {
		expect(motsCles("What did you use as design motifs?", "…", lexique)).not.toContain("what");
	});
});

describe("garde-fou des sources", () => {
	test("aucun document admis n'est un wiki de fans", () => {
		for (const doc of DOCUMENTS) expect(REFUSÉ.test(doc.motif)).toBe(false);
	});

	test("le garde-fou attrape les noms de fichiers interdits", () => {
		for (const nom of ["fandom-broly-fr.md", "wikipedia-dragon-ball.md", "wiki-dbz.md"]) {
			expect(REFUSÉ.test(nom)).toBe(true);
		}
	});
});
