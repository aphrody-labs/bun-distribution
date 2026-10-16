import { describe, expect, test } from "bun:test";

import {
	PATRON_DISCOUNT_PERCENT,
	PATRON_STRIPE_COUPON_ID,
	REMISE_ABSENTE,
	remiseDepuisAdhesion,
} from "./discount";

describe("PATRON_DISCOUNT_PERCENT", () => {
	test("vaut 20 % — décision produit, pas une valeur d'ajustement", () => {
		expect(PATRON_DISCOUNT_PERCENT).toBe(20);
	});

	test("le coupon Stripe est renseigné", () => {
		// Un identifiant vide ferait échouer `checkout.sessions.create` au moment
		// du paiement, pas au démarrage : l'erreur ne se voit qu'en caisse.
		expect(PATRON_STRIPE_COUPON_ID).toBeTruthy();
		expect(typeof PATRON_STRIPE_COUPON_ID).toBe("string");
	});
});

describe("remiseDepuisAdhesion", () => {
	test("aucune adhésion → aucune remise", () => {
		expect(remiseDepuisAdhesion(null)).toEqual(REMISE_ABSENTE);
		expect(remiseDepuisAdhesion(null).active).toBe(false);
	});

	test("un patron actif ouvre droit à la remise", () => {
		const r = remiseDepuisAdhesion({
			currently_entitled_cents: 500,
			patron_status: "active_patron",
			tier_titles: ["Niveau Evans"],
		});
		expect(r.active).toBe(true);
		expect(r.percent).toBe(20);
		expect(r.stripeCouponId).toBe(PATRON_STRIPE_COUPON_ID);
		expect(r.tierTitles).toEqual(["Niveau Evans"]);
		expect(r.currentlyEntitledCents).toBe(500);
	});

	test.each(["former_patron", "declined_patron", "", "ACTIVE_PATRON", "active"])(
		"le statut %p n'ouvre AUCUN droit",
		(statut) => {
			// Seul `active_patron` compte. Un `startsWith("active")` accorderait
			// −20 % à vie aux anciens patrons dont le prélèvement a été refusé.
			expect(remiseDepuisAdhesion({ patron_status: statut }).active).toBe(false);
		}
	);

	test("un statut inconnu est rapporté tel quel pour le diagnostic", () => {
		expect(remiseDepuisAdhesion({ patron_status: "zombie" }).patronStatus).toBe("zombie");
	});

	test("les champs absents se normalisent sans faire planter l'affichage", () => {
		const r = remiseDepuisAdhesion({ patron_status: "active_patron" });
		expect(r.tierTitles).toEqual([]);
		expect(r.currentlyEntitledCents).toBe(null);
	});

	test("un `tier_titles` nul devient un tableau, jamais null", () => {
		// L'UI fait `tierTitles.map(...)` : un `null` casserait le rendu du badge.
		expect(remiseDepuisAdhesion({ patron_status: "active_patron", tier_titles: null }).tierTitles)
			.toEqual([]);
	});

	test("un montant à zéro reste zéro et non null", () => {
		expect(
			remiseDepuisAdhesion({ currently_entitled_cents: 0, patron_status: "active_patron" })
				.currentlyEntitledCents
		).toBe(0);
	});

	test("la remise porte toujours le même pourcentage et le même coupon", () => {
		for (const statut of ["active_patron", "former_patron"]) {
			const r = remiseDepuisAdhesion({ patron_status: statut });
			expect(r.percent).toBe(PATRON_DISCOUNT_PERCENT);
			expect(r.stripeCouponId).toBe(PATRON_STRIPE_COUPON_ID);
		}
	});
});
