/**
 * Marque-page local des fiches consultées.
 *
 * Il double délibérément la télémétrie : celle-ci est en opt-in strict et vit
 * côté serveur, donc elle ne peut pas servir « reprendre où vous en étiez »
 * sans lire un cookie au rendu — ce qui ferait tomber le cache CDN de tout le
 * site. Ici rien ne sort de l'appareil.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
	HISTORIQUE_MAX,
	lireHistorique,
	noterVisite,
	reprises,
	viderHistorique,
} from "@/lib/historique-local";

// `localStorage` n'existe pas dans bun:test — on en pose un minimal.
const memoire = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
	getItem: (k: string) => memoire.get(k) ?? null,
	setItem: (k: string, v: string) => void memoire.set(k, v),
	removeItem: (k: string) => void memoire.delete(k),
	clear: () => memoire.clear(),
	key: () => null,
	length: 0,
} as unknown as Storage;

const fiche = (n: number) => ({
	href: `/wiki/personnages/${n}`,
	titre: `Perso ${n}`,
	rubrique: "Personnage",
	image: null,
});

describe("historique local", () => {
	beforeEach(() => memoire.clear());

	test("vide au départ", () => {
		expect(lireHistorique()).toEqual([]);
	});

	test("la dernière visite est en tête", () => {
		noterVisite(fiche(1));
		noterVisite(fiche(2));
		expect(lireHistorique().map((e) => e.titre)).toEqual(["Perso 2", "Perso 1"]);
	});

	test("revoir une fiche la remonte au lieu de la dupliquer", () => {
		noterVisite(fiche(1));
		noterVisite(fiche(2));
		noterVisite(fiche(1));
		const h = lireHistorique();
		expect(h).toHaveLength(2);
		expect(h[0].titre).toBe("Perso 1");
	});

	test("la liste est bornée", () => {
		for (let i = 0; i < HISTORIQUE_MAX + 10; i++) noterVisite(fiche(i));
		expect(lireHistorique()).toHaveLength(HISTORIQUE_MAX);
	});

	test("un contenu corrompu ne fait pas tomber la page", () => {
		memoire.set("dbfr:historique", "{ pas du json");
		expect(lireHistorique()).toEqual([]);
		memoire.set("dbfr:historique", '{"pas":"un tableau"}');
		expect(lireHistorique()).toEqual([]);
		memoire.set("dbfr:historique", '[{"href":123}]');
		expect(lireHistorique()).toEqual([]);
	});

	test("« reprendre » oublie ce qui date de plus d'un mois", () => {
		noterVisite(fiche(1));
		const dansDeuxMois = Date.now() + 60 * 24 * 3600 * 1000;
		expect(reprises()).toHaveLength(1);
		expect(reprises(dansDeuxMois)).toHaveLength(0);
	});

	test("effacer vide tout", () => {
		noterVisite(fiche(1));
		viderHistorique();
		expect(lireHistorique()).toEqual([]);
	});
});
