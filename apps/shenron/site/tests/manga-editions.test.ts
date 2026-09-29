import { describe, expect, test } from "bun:test";
import {
	CODES_EDITION,
	decodeEdition,
	editionCompleteDe,
	editionDe,
	editionPubliee,
	EDITIONS_PUBLIEES,
	estChapitreCouleur,
	langueDe,
	libelleEdition,
	libelleSerie,
	serieOeuvre,
} from "../src/lib/manga-editions";

/**
 * Ces cas verrouillent des décisions structurelles, pas des détails d'affichage :
 * une série mal rangée décale la navigation précédent/suivant, et une édition
 * annoncée comme publiée alors qu'elle ne l'est pas envoie chercher des scans
 * qui n'ont jamais existé.
 */
describe("colorisation", () => {
	test("la série tranche, pas le titre", () => {
		expect(estChapitreCouleur({ series: "DBFC", title: "Bulma et Son Goku" })).toBe(true);
		expect(estChapitreCouleur({ series: "DB", title: "Bulma et Son Goku" })).toBe(false);
	});

	test("le titre n'a plus aucune influence", () => {
		// Mesuré le 2026-09-04 : 0 chapitre sur 665 porte « couleur » dans son
		// titre. Le repli qui lisait le titre ne protégeait donc plus rien, et
		// faisait basculer d'édition un chapitre nommé « Les couleurs de Boo ».
		expect(estChapitreCouleur({ series: "DB", title: "Chapitre 1 (Full Color)" })).toBe(false);
		expect(estChapitreCouleur({ series: "DBS", title: "Les couleurs de Boo" })).toBe(false);
	});
});

describe("langue", () => {
	test("le français est le défaut, y compris pour une série inconnue", () => {
		expect(langueDe({ series: "DB" })).toBe("fr");
		expect(langueDe({ series: "SERIE_INCONNUE" })).toBe("fr");
	});

	test("les séries japonaises ont leur place réservée", () => {
		expect(langueDe({ series: "DBJP" })).toBe("ja");
		expect(editionCompleteDe({ series: "DBFCJP" })).toBe("ja-couleur");
	});

	test("l'édition complète croise bien les deux dimensions", () => {
		expect(editionCompleteDe({ series: "DB" })).toBe("fr-nb");
		expect(editionCompleteDe({ series: "DBFC" })).toBe("fr-couleur");
	});
});

describe("codes d'édition", () => {
	test("les quatre codes se décodent, et rien d'autre", () => {
		for (const code of CODES_EDITION) expect(decodeEdition(code)).not.toBeNull();
		expect(decodeEdition("fr")).toBeNull();
		expect(decodeEdition("en-nb")).toBeNull();
	});

	test("le libellé nomme les deux dimensions", () => {
		expect(libelleEdition("ja-couleur")).toBe("Japonais · Couleur");
	});
});

describe("ce que l'éditeur a réellement publié", () => {
	test("Dragon Ball a ses quatre versions", () => {
		expect(EDITIONS_PUBLIEES.DB).toHaveLength(4);
		for (const code of CODES_EDITION) expect(editionPubliee("DB", code)).toBe(true);
	});

	test("Super n'a jamais été colorisé — deux cases n'existent pas", () => {
		expect(editionPubliee("DBS", "fr-nb")).toBe(true);
		expect(editionPubliee("DBS", "ja-nb")).toBe(true);
		expect(editionPubliee("DBS", "fr-couleur")).toBe(false);
		expect(editionPubliee("DBS", "ja-couleur")).toBe(false);
	});
});

describe("série d'œuvre", () => {
	test("toutes les éditions de Dragon Ball retombent sur DB", () => {
		for (const s of ["DB", "DBFC", "DBJP", "DBFCJP", "SOSH", "DB_SOSH", "DBKZ"]) expect(serieOeuvre(s)).toBe("DB");
	});

	test("l'édition japonaise de Super retombe sur DBS", () => {
		expect(serieOeuvre("DBSJP")).toBe("DBS");
	});

	test("la colorisation seule reste utilisable telle quelle", () => {
		expect(editionDe({ series: "DBFC" })).toBe("couleur");
		expect(editionDe({ series: "DBSJP" })).toBe("nb");
	});
});

describe("libellés des spin-offs catalogués", () => {
	test("les huit clés metadata-only ont un libellé de découverte stable", () => {
		expect(libelleSerie("DB_SD")).toBe("Dragon Ball SD");
		expect(libelleSerie("DB_GAIDEN_YAMCHA")).toContain("Yamcha");
		expect(libelleSerie("SDBH_DARK_DEMON_REALM")).toContain("Dark Demon Realm");
		expect(libelleSerie("SDBH_UNIVERSE")).toContain("Universe Mission");
		expect(libelleSerie("SDBH_BIG_BANG")).toContain("Big Bang Mission");
		expect(libelleSerie("SDBH_ULTRA_GOD")).toContain("Ultra God Mission");
		expect(libelleSerie("SDBH_METEOR")).toContain("Meteor Mission");
		expect(libelleSerie("SDBH_AVATARS")).toContain("Avatars");
	});
});
