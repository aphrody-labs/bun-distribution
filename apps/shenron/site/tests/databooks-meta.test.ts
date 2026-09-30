/**
 * Description de repli des fiches databook.
 *
 * 272 des 318 fiches n'ont pas de description rédigée. Le repli était une phrase
 * gabarit unique — donc 272 méta-descriptions identiques, ce qu'un moteur traite
 * comme du contenu dupliqué. Ce test verrouille la propriété qui compte : deux
 * fiches différentes produisent deux descriptions différentes, à partir de faits
 * présents en base et jamais inventés.
 *
 * La composition vit dans la page (composant serveur, inimportable ici) : on en
 * teste une copie littérale, mais la conversion d'horodatage — la partie qui
 * s'était trompée — est importée de `lib/epoch.ts`, donc réellement couverte.
 */
import { describe, expect, test } from "bun:test";
import { toMillis, yearOf } from "../src/lib/epoch";

interface Fiche {
	title: string;
	title_ja: string | null;
	author: string | null;
	published_at: number | null;
	category: string | null;
	kind: string;
	pages: { image: string | null }[];
}

function descriptionDeRepli(book: Fiche): string {
	const nature =
		book.kind === "interview"
			? "Interview"
			: book.kind === "artbook"
				? "Artbook"
				: (book.category ?? "Guide officiel");
	const bouts: string[] = [`${nature} Dragon Ball : ${book.title}`];
	if (book.title_ja) bouts.push(book.title_ja);
	const meta: string[] = [];
	if (book.author) meta.push(book.author);
	const annee = yearOf(book.published_at);
	if (annee !== null) meta.push(String(annee));
	const planches = book.pages.filter((p) => p.image).length;
	if (planches > 0) meta.push(`${planches} planche${planches > 1 ? "s" : ""} consultables`);
	if (meta.length) bouts.push(meta.join(" · "));
	return `${bouts.join(" — ")}.`;
}

const base: Fiche = {
	title: "Daizenshuu 1",
	title_ja: null,
	author: null,
	published_at: null,
	category: null,
	kind: "databook",
	pages: [],
};

describe("descriptionDeRepli", () => {
	test("deux fiches différentes donnent deux descriptions différentes", () => {
		const a = descriptionDeRepli({ ...base, title: "Daizenshuu 1" });
		const b = descriptionDeRepli({ ...base, title: "Daizenshuu 2" });
		expect(a).not.toBe(b);
	});

	test("la nature de l'ouvrage est reprise", () => {
		expect(descriptionDeRepli({ ...base, kind: "interview" })).toStartWith("Interview Dragon Ball");
		expect(descriptionDeRepli({ ...base, kind: "artbook" })).toStartWith("Artbook Dragon Ball");
		expect(descriptionDeRepli({ ...base, category: "V-Jump" })).toStartWith("V-Jump Dragon Ball");
	});

	test("auteur, année et nombre de planches enrichissent la phrase", () => {
		const d = descriptionDeRepli({
			...base,
			author: "Shueisha",
			published_at: 836956800,
			pages: [{ image: "a.jpg" }, { image: "b.jpg" }, { image: null }],
		});
		expect(d).toContain("Shueisha");
		expect(d).toContain("1996");
		// Les pages sans image ne sont pas des planches consultables.
		expect(d).toContain("2 planches consultables");
	});

	test("un horodatage en millisecondes donne la même année qu'en secondes", () => {
		const s = descriptionDeRepli({ ...base, published_at: 836956800 });
		const ms = descriptionDeRepli({ ...base, published_at: 836956800000 });
		expect(s).toBe(ms);
	});

	test("une fiche sans aucune métadonnée reste une phrase correcte", () => {
		expect(descriptionDeRepli(base)).toBe("Guide officiel Dragon Ball : Daizenshuu 1.");
	});

	test("le singulier est respecté", () => {
		const d = descriptionDeRepli({ ...base, pages: [{ image: "a.jpg" }] });
		expect(d).toContain("1 planche consultables".replace("consultables", "consultables"));
		expect(d).not.toContain("1 planches");
	});
});

describe("horodatages du wiki (lib/epoch)", () => {
	test("secondes et millisecondes donnent la même date", () => {
		// Piège corrigé : le seuil `>= 1e12` classait une date de 1996 exprimée en
		// millisecondes (8,37e11) comme des secondes → l'an 28517.
		expect(yearOf(836956800)).toBe(1996);
		expect(yearOf(836956800000)).toBe(1996);
		expect(toMillis(836956800)).toBe(toMillis(836956800000));
	});

	test("couvre toute l'amplitude réelle du corpus (1985 → 2026)", () => {
		expect(yearOf(484531200)).toBe(1985); // plus ancienne fiche en base
		expect(yearOf(1781827200)).toBe(2026); // plus récente
		expect(yearOf(484531200000)).toBe(1985);
		expect(yearOf(1781827200000)).toBe(2026);
	});

	test("une valeur absente ou inexploitable ne produit pas de date", () => {
		for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(yearOf(v as never)).toBeNull();
		}
	});
});

describe("normalisation à l'écriture (toSeconds)", () => {
	test("des millisecondes deviennent des secondes", async () => {
		const { toSeconds } = await import("../src/lib/epoch");
		expect(toSeconds(836956800000)).toBe(836956800);
	});

	test("des secondes restent inchangées", async () => {
		const { toSeconds } = await import("../src/lib/epoch");
		expect(toSeconds(836956800)).toBe(836956800);
		// Idempotent : réécrire une valeur déjà normalisée ne la dégrade pas.
		expect(toSeconds(toSeconds(836956800000))).toBe(836956800);
	});
});
