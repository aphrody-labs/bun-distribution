/**
 * Ciblage d'une planche de databook (`pages#42`).
 *
 * C'est ce qui ouvre les 1 911 transcriptions fautives à la correction
 * communautaire. Une erreur ici laisse passer une cible qui n'existe pas — ou,
 * pire, en refuse une valide et referme la porte sans le dire.
 */
import { describe, expect, it, test } from "bun:test";
import {
	estCibleJsonbPlanche,
	estCiblePlanche,
	estCibleTraduction,
	numeroDePlanche,
	numeroDeTraduction,
	PREFIXE_PLANCHE,
} from "@/lib/databook-pages-shared";

describe("numeroDePlanche", () => {
	test("lit le numéro d'une cible bien formée", () => {
		expect(numeroDePlanche("pages#42")).toBe(42);
		expect(numeroDePlanche("pages#1")).toBe(1);
	});

	test("refuse ce qui n'est pas un numéro de planche", () => {
		for (const c of [
			"article",
			"pages",
			"pages#",
			"pages#0",
			"pages#-3",
			"pages#1.5",
			"pages#abc",
		]) {
			expect(numeroDePlanche(c)).toBeNull();
		}
	});

	test("le préfixe est celui qu'on croit", () => {
		expect(PREFIXE_PLANCHE).toBe("pages#");
	});
});

describe("estCiblePlanche", () => {
	test("ne vaut que pour les databooks", () => {
		expect(estCiblePlanche("db_databooks", "pages#7")).toBe(true);
		// Une autre table avec un jsonb `pages` (chapitres de manga) ne doit pas
		// hériter du droit par accident.
		expect(estCiblePlanche("db_manga_chapters", "pages#7")).toBe(false);
		expect(estCiblePlanche("db_characters", "pages#7")).toBe(false);
	});

	test("une colonne ordinaire de databook n'est pas une planche", () => {
		expect(estCiblePlanche("db_databooks", "description")).toBe(false);
		expect(estCiblePlanche("db_databooks", "pages")).toBe(false);
	});
});

describe("cible de traduction", () => {
	// Sans cette convention, `depose-traductions.ts` écrivait ses révisions sous
	// une forme maison que le retour arrière ne savait pas lire : le bouton
	// « Annuler » de /admin/wiki/history échouait sur TOUTE traduction.
	it("reconnaît `traduction#<n>` et en extrait le numéro", () => {
		expect(numeroDeTraduction("traduction#42")).toBe(42);
		expect(estCibleTraduction("db_databooks", "traduction#1")).toBe(true);
	});

	it("refuse les formes approchantes plutôt que de deviner", () => {
		expect(numeroDeTraduction("traduction#")).toBeNull();
		expect(numeroDeTraduction("traduction# 4 ")).toBeNull();
		expect(numeroDeTraduction("traduction#0")).toBeNull();
		expect(numeroDeTraduction("traduction#-1")).toBeNull();
		expect(numeroDeTraduction("pages#42")).toBeNull();
		expect(estCibleTraduction("db_characters", "traduction#1")).toBe(false);
	});

	it("ne confond jamais transcription et traduction", () => {
		expect(estCiblePlanche("db_databooks", "traduction#42")).toBe(false);
		expect(estCibleTraduction("db_databooks", "pages#42")).toBe(false);
		// …mais le revert doit écarter les DEUX de la liste des colonnes.
		expect(estCibleJsonbPlanche("db_databooks", "pages#42")).toBe(true);
		expect(estCibleJsonbPlanche("db_databooks", "traduction#42")).toBe(true);
		expect(estCibleJsonbPlanche("db_databooks", "description")).toBe(false);
	});
});
