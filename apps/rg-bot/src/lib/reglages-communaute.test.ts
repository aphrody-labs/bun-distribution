/**
 * Tests du schéma de réglages.
 *
 * Le piège qu'ils gardent est réel et coûteux : en **zod 4**, `.default({})`
 * sur un objet ne fait PAS remonter les défauts de ses champs — la valeur est
 * rendue telle quelle, et on obtient `{}` là où on croit avoir un document
 * complet. La commande suivante lit alors `reglages.tickets.rolesStaff.length`
 * sur `undefined`. C'est `.prefault({})` qui fait passer la valeur par le
 * schéma. Ces tests échouent si quelqu'un revient sur `.default`.
 */
import { describe, expect, test } from "bun:test";

import { GAIN_DEFAUT } from "./experience";
import {
	fusionnerReglages,
	lireReglages,
	manquesTickets,
	REGLAGES_DEFAUT,
	validerReglages,
} from "./reglages-communaute";

describe("document par défaut", () => {
	test("un document vide rend TOUTES les valeurs, pas des sections vides", () => {
		expect(REGLAGES_DEFAUT.niveaux.actif).toBe(true);
		expect(REGLAGES_DEFAUT.niveaux.annonce).toBe("aucune");
		expect(REGLAGES_DEFAUT.niveaux.palierAnnonce).toBe(5);
		expect(REGLAGES_DEFAUT.niveaux.annoncerRang).toBe(true);
		expect(REGLAGES_DEFAUT.niveaux.gain.minimum).toBe(GAIN_DEFAUT.minimum);
		expect(REGLAGES_DEFAUT.niveaux.gain.delaiSecondes).toBe(GAIN_DEFAUT.delaiSecondes);
		expect(REGLAGES_DEFAUT.tickets.rolesStaff).toEqual([]);
		expect(REGLAGES_DEFAUT.tickets.mode).toBe("fil");
		expect(REGLAGES_DEFAUT.kizuna.actif).toBe(true);
	});

	test("un bot fraîchement installé ne publie RIEN de lui-même", () => {
		// `place` est le défaut du marché ; il transforme chaque salon en flux
		// d'annonces sur un serveur de deux mille membres. Ici, tant que le staff
		// n'a pas dit où annoncer, on n'annonce nulle part.
		expect(REGLAGES_DEFAUT.niveaux.annonce).toBe("aucune");
		expect(REGLAGES_DEFAUT.niveaux.salonAnnonce).toBeNull();
	});
});

describe("lecture d'un document de base", () => {
	test("un document partiel est complété, pas rejeté", () => {
		const lu = lireReglages({ tickets: { mode: "salon" } });
		expect(lu.tickets.mode).toBe("salon");
		expect(lu.tickets.rolesStaff).toEqual([]);
		expect(lu.niveaux.actif).toBe(true);
	});

	test("un document corrompu ne fait PAS tomber la commande", () => {
		expect(lireReglages({ niveaux: "oui" })).toEqual(REGLAGES_DEFAUT);
		expect(lireReglages(null)).toEqual(REGLAGES_DEFAUT);
		expect(lireReglages("[]")).toEqual(REGLAGES_DEFAUT);
	});

	test("les identifiants en double sont dédoublonnés", () => {
		const lu = lireReglages({
			tickets: { rolesStaff: ["1086314307383459880", "1086314307383459880"] },
		});
		expect(lu.tickets.rolesStaff).toEqual(["1086314307383459880"]);
	});
});

describe("écriture", () => {
	test("un identifiant qui n'en est pas un est REFUSÉ à l'écriture", () => {
		// À la lecture on pardonne, à l'écriture non : l'écriture est volontaire.
		expect(() => validerReglages({ tickets: { salonPanneau: "salon-general" } })).toThrow();
	});

	test("une fourchette de gain aberrante est refusée", () => {
		expect(() => validerReglages({ niveaux: { gain: { minimum: -5 } } })).toThrow();
		expect(() => validerReglages({ niveaux: { gain: { delaiSecondes: 99_999 } } })).toThrow();
	});

	test("un lieu d'annonce inconnu est refusé", () => {
		expect(() => validerReglages({ niveaux: { annonce: "partout" } })).toThrow();
	});
});

describe("fusion", () => {
	test("modifier une section n'efface pas ses voisines", () => {
		const avec = fusionnerReglages(REGLAGES_DEFAUT, {
			tickets: { rolesStaff: ["1086314307383459880"] },
		});
		const apres = fusionnerReglages(avec, { tickets: { mode: "salon" } });
		expect(apres.tickets.rolesStaff).toEqual(["1086314307383459880"]);
		expect(apres.tickets.mode).toBe("salon");
		expect(apres.niveaux.annonce).toBe("aucune");
	});

	test("remplacer une liste la REMPLACE — sinon on ne pourrait rien retirer", () => {
		const avec = fusionnerReglages(REGLAGES_DEFAUT, {
			niveaux: { salonsExclus: ["1135716082972381234", "1073227462500163626"] },
		});
		const apres = fusionnerReglages(avec, { niveaux: { salonsExclus: ["1135716082972381234"] } });
		expect(apres.niveaux.salonsExclus).toEqual(["1135716082972381234"]);
	});
});

describe("manques des tickets", () => {
	test("une guilde vierge liste ce qu'il reste à poser", () => {
		const manques = manquesTickets(REGLAGES_DEFAUT);
		expect(manques).toHaveLength(3);
		expect(manques.join(" ")).toContain("panneau");
		expect(manques.join(" ")).toContain("historique");
	});

	test("configurée, elle ne manque de rien", () => {
		const complet = fusionnerReglages(REGLAGES_DEFAUT, {
			tickets: {
				rolesStaff: ["1086314307383459880"],
				salonHistorique: "1097198504667005099",
				salonPanneau: "1097189982826938529",
			},
		});
		expect(manquesTickets(complet)).toEqual([]);
	});

	test("le mode salon exige la catégorie Support", () => {
		const salon = fusionnerReglages(REGLAGES_DEFAUT, {
			tickets: {
				mode: "salon",
				rolesStaff: ["1086314307383459880"],
				salonHistorique: "1097198504667005099",
				salonPanneau: "1097189982826938529",
			},
		});
		expect(manquesTickets(salon)).toHaveLength(1);
		expect(manquesTickets(salon)[0]).toContain("catégorie");
	});
});
