/**
 * Pont markdown du module d'édition — le garde-fou qui autorise l'édition riche
 * sur le contenu historique du wiki.
 *
 * Ce que ces tests protègent : ouvrir une page dans l'éditeur puis la
 * réenregistrer ne doit ni perdre du contenu, ni changer le rendu. Les cas
 * couverts viennent tous de bugs constatés sur le corpus réel (3 544 documents
 * rejoués : 3 543 rendus strictement identiques, le dernier étant une source
 * dont l'imbrication de gras était déjà cassée et que la sérialisation répare).
 */
import { describe, expect, test } from "bun:test";

import { buildExtensions } from "@/components/editor/schema";
import { markdownToHtml, parseMarkdown } from "@/components/editor/markdown/parse";
import { serializeMarkdown } from "@/components/editor/markdown/serialize";

const ext = buildExtensions("wiki");

/** Aller-retour source → document → source. */
function roundTrip(md: string): string {
	return serializeMarkdown(parseMarkdown(md, ext));
}

/** Rendu normalisé (ce que verra le lecteur), espaces insignifiants ignorés. */
function rendered(md: string): string {
	return markdownToHtml(
		md
			.split("\n")
			.map((l) => l.replace(/[ \t]+$/, ""))
			.join("\n")
	)
		.replace(/\s+/g, " ")
		.replace(/>\s+</g, "><")
		.trim();
}

function expectStable(md: string) {
	expect(roundTrip(md).trim()).toBe(md.trim());
}

describe("markdown de base", () => {
	test("titres, emphases, liens, listes et citations sont rendus à l'identique", () => {
		expectStable(`# Titre

Un **paragraphe** avec de l'*italique*, du \`code\` et un [lien](https://exemple.fr).

## Sous-titre

- item 1
- item 2

1. premier
2. second

> Une citation

---`);
	});

	test("le gras contenant de l'italique ne produit pas de suite d'astérisques", () => {
		// Cas réel : les chapeaux de fiches sont entièrement en gras et citent des
		// titres d'œuvres en italique. Traiter chaque fragment isolément donnait
		// `**Goku (***Dragon Ball***) est…**`, illisible pour tout parseur.
		const md = "**Goku est le héros de *Dragon Ball*, un Saiyan.**";
		const out = roundTrip(md).trim();
		expect(out).toBe(md);
		expect(out).not.toContain("***");
	});

	test("les appels de note ne sont pas échappés, les liens le sont", () => {
		expect(roundTrip("Une affirmation sourcée [3] puis [ 4 ].").trim()).toBe(
			"Une affirmation sourcée [3] puis [ 4 ]."
		);
		// Un vrai lien reste un vrai lien.
		expect(roundTrip("Voir [la fiche](/wiki/goku).").trim()).toBe("Voir [la fiche](/wiki/goku).");
	});
});

describe("blocs de mise en page du wiki", () => {
	test("figure dimensionnée et placée", () => {
		expectStable(`<figure class="wiki-float-right wiki-size-md">
  <img src="./assets/wiki/goku.webp" alt="Goku" />
  <figcaption>Goku</figcaption>
</figure>`);
	});

	test("une figure sans légende n'insère pas l'image en double", () => {
		const md = `<figure class="wiki-img wiki-size-md">
  <img src="./assets/wiki/kid-buu.png" alt="" />
</figure>`;
		const out = roundTrip(md);
		expect(out.match(/kid-buu\.png/g)).toHaveLength(1);
		expect(rendered(out)).toBe(rendered(md));
	});

	test("section repliable, encadré, colonnes et espace", () => {
		expectStable(`<details class="wiki-section">
<summary>Histoire</summary>

Le contenu de la section.

</details>

<div class="wiki-callout wiki-callout--info">

Un encadré informatif.

</div>

<div class="wiki-cols wiki-cols-2">
<div>

Colonne 1

</div>
<div>

Colonne 2

</div>
</div>

<div class="wiki-spacer" style="height:48px"></div>`);
	});

	test("badge de niveau de puissance", () => {
		expectStable(
			'Puissance mesurée <span class="ki-power"><span class="ki-power-ctx">Saga Saiyan</span><span class="ki-power-val">8 000</span></span> au combat.'
		);
	});

	test("tableau GFM", () => {
		expectStable(`| Nom | Race |
| --- | --- |
| Goku | Saiyan |
| Piccolo | Namek |`);
	});
});

describe("HTML libre écrit à la main", () => {
	test("un conteneur inconnu garde sa balise, ses classes et son contenu éditable", () => {
		expectStable(`<aside class="wiki-infobox">

**Titre**

- Champ : valeur

</aside>`);
	});

	test("le style en ligne d'un conteneur est préservé", () => {
		expectStable(`<div style="text-align:center">

Texte centré

</div>`);
	});

	test("un lecteur vidéo intégré survit à l'aller-retour", () => {
		const md = `<div class="wiki-embed">
<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Vidéo" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
</div>`;
		expect(roundTrip(md)).toContain("dQw4w9WgXcQ");
		expect(rendered(roundTrip(md))).toBe(rendered(md));
	});
});

describe("document composite", () => {
	test("une page complète conserve exactement son rendu", () => {
		const md = `# Son Goku

**Son Goku** (孫悟空) est un [Saiyan](/wiki/races/saiyan) et le héros de *Dragon Ball*.

<figure class="wiki-float-right wiki-size-lg">
  <img src="./assets/wiki/goku.webp" alt="Goku" />
  <figcaption>Son Goku</figcaption>
</figure>

<details class="wiki-section">
<summary>Pouvoirs</summary>

Il maîtrise le Kaméhaméha et l'Ultra Instinct.

</details>

| Forme | Multiplicateur |
| --- | --- |
| Super Saiyan | ×50 |
`;
		expect(rendered(roundTrip(md))).toBe(rendered(md));
	});
});
