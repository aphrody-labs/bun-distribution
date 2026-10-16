/**
 * Tests du noyau pur « boutique & soutien Patreon ».
 *
 * Les jeux d'essai Patreon reproduisent EXACTEMENT le relevé de la base du
 * 13/8/2026 (11 lignes de `patreon_memberships`) : 3 soutiens actifs sur le
 * palier « 𝙽𝚒𝚟𝚎𝚊𝚞 𝙴𝚟𝚊𝚗𝚜 🌹 » à 14,50 €, 4 anciens soutiens et 4 abonnés sans
 * engagement, tous étiquetés « Free » à 0 €. Aucune donnée personnelle n'entre
 * ici : ni e-mail, ni nom, ni adresse — le type `AdhesionPatreon` ne les porte
 * même pas.
 *
 * ⚠ `Intl.NumberFormat("fr-FR")` sépare le nombre du « € » par une espace
 * INSÉCABLE : U+00A0 avec l'ICU de Bun 1.4 sur ce VPS, U+202F (fine) avec
 * d'autres versions. Toute comparaison passe donc par `espaces()`, sinon le
 * test échoue sur un caractère invisible qui n'est même pas toujours le même.
 */
import { describe, expect, test } from "bun:test";

import { formatEuros, PRODUCTS } from "@rosegriffon/types/shop";
import {
	accorderSoutiens,
	agregerPaliers,
	BASE_BOUTIQUE,
	CATALOGUE,
	CATEGORIES,
	catalogueParCategorie,
	champsCatalogue,
	chercherProduits,
	classerStatutPatron,
	compterParStatut,
	formaterCadence,
	formaterDateFr,
	formaterEuros,
	formaterFourchettePrix,
	libellePrelevement,
	libelleStatutPatron,
	libelleStock,
	ligneCatalogue,
	lignePalier,
	MAX_CHAMPS_EMBED,
	MAX_TOTAL_EMBED,
	MAX_VALEUR_CHAMP,
	normaliser,
	paliersDeLAdhesion,
	resumerAdhesion,
	trouverProduit,
	urlFicheProduit,
	urlImageProduit,
	type AdhesionPatreon,
} from "./boutique-format";

/** Ramène toutes les espèces d'espaces (dont U+202F et U+00A0) à l'espace simple. */
function espaces(valeur: string): string {
	return valeur.replaceAll(/\s+/gu, " ");
}

const PALIER_EVANS = "𝙽𝚒𝚟𝚎𝚊𝚞 𝙴𝚟𝚊𝚗𝚜 🌹";

function adhesion(patch: Partial<AdhesionPatreon> = {}): AdhesionPatreon {
	return {
		currently_entitled_cents: 0,
		is_free_trial: false,
		is_gifted: false,
		last_charge_date: null,
		last_charge_status: null,
		lifetime_support_cents: 0,
		next_charge_date: null,
		patron_status: null,
		pledge_cadence: 1,
		pledge_start: null,
		tier_amounts_cents: [0],
		tier_titles: ["Free"],
		...patch,
	};
}

/** Les 11 lignes réelles de `patreon_memberships`, réduites aux colonnes non personnelles. */
const ADHESIONS_REELLES: AdhesionPatreon[] = [
	// ⚠ Cette première ligne prélève à l'ANNÉE (`pledge_cadence = 12`), pas au
	// mois : c'est la seule des onze, et c'est le seul jeu d'essai qui couvre la
	// branche annuelle de `formaterCadence`.
	adhesion({
		currently_entitled_cents: 14_542,
		last_charge_date: "2025-10-20",
		last_charge_status: "Paid",
		lifetime_support_cents: 14_542,
		next_charge_date: "2026-10-20",
		patron_status: "active_patron",
		pledge_cadence: 12,
		pledge_start: "2025-10-20",
		tier_amounts_cents: [1450],
		tier_titles: [PALIER_EVANS],
	}),
	adhesion({
		currently_entitled_cents: 1450,
		last_charge_date: "2026-04-12",
		last_charge_status: "Paid",
		lifetime_support_cents: 20_920,
		next_charge_date: "2026-05-12",
		patron_status: "active_patron",
		pledge_start: "2025-05-12",
		tier_amounts_cents: [1450],
		tier_titles: [PALIER_EVANS],
	}),
	adhesion({
		currently_entitled_cents: 1450,
		last_charge_date: "2026-05-02",
		last_charge_status: "Paid",
		lifetime_support_cents: 21_027,
		next_charge_date: "2026-05-26",
		patron_status: "active_patron",
		pledge_start: "2025-05-11",
		tier_amounts_cents: [1450],
		tier_titles: [PALIER_EVANS],
	}),
	// Un dernier prélèvement REFUSÉ ne fait pas de cette ligne un « paiement
	// refusé » : c'est `patron_status` qui classe, et il dit « ancien soutien ».
	adhesion({
		last_charge_date: "2026-03-10",
		last_charge_status: "Declined",
		lifetime_support_cents: 15_631,
		patron_status: "former_patron",
	}),
	adhesion({
		last_charge_date: "2025-12-15",
		last_charge_status: "Paid",
		lifetime_support_cents: 1526,
		patron_status: "former_patron",
	}),
	adhesion({
		last_charge_date: "2026-03-03",
		last_charge_status: "Paid",
		lifetime_support_cents: 9122,
		patron_status: "former_patron",
	}),
	adhesion({
		last_charge_date: "2025-12-19",
		last_charge_status: "Paid",
		lifetime_support_cents: 5100,
		patron_status: "former_patron",
	}),
	adhesion(),
	adhesion(),
	adhesion(),
	adhesion(),
];

describe("catalogue", () => {
	test("les 12 produits servis par le site sont repris, sans perte", () => {
		expect(CATALOGUE.length).toBe(PRODUCTS.length);
		expect(CATALOGUE.length).toBeGreaterThanOrEqual(12);
		expect(new Set(CATALOGUE.map((p) => p.slug)).size).toBe(CATALOGUE.length);
	});

	test("aucun produit n'a de prix, de nom ou de famille manquants", () => {
		for (const produit of CATALOGUE) {
			expect(produit.slug.length).toBeGreaterThan(0);
			expect(produit.nom.length).toBeGreaterThan(0);
			expect(produit.categorieLibelle.length).toBeGreaterThan(0);
			expect(produit.prixCents).toBeGreaterThan(0);
			expect(produit.prixMaxCents).toBeGreaterThanOrEqual(produit.prixCents);
			expect(produit.image.startsWith("/")).toBe(true);
		}
	});

	test("la variante la plus chère fixe le haut de la fourchette", () => {
		const pack = trouverProduit("pack-personnage-destin-billows");
		expect(pack).not.toBeNull();
		expect(pack?.prixCents).toBe(2490);
		expect(pack?.prixMaxCents).toBe(7990);
		expect(pack?.variantes.length).toBe(5);
		expect(espaces(formaterFourchettePrix(pack as NonNullable<typeof pack>))).toBe(
			"de 24,90 € à 79,90 €"
		);
	});

	test("sans variante, la fourchette est un prix unique", () => {
		const print = trouverProduit("print-a5-roy-fonteneau");
		expect(print?.prixCents).toBe(990);
		expect(espaces(formaterFourchettePrix(print as NonNullable<typeof print>))).toBe("9,90 €");
	});

	test("les familles couvrent tout le catalogue", () => {
		const total = catalogueParCategorie().reduce((n, g) => n + g.produits.length, 0);
		expect(total).toBe(CATALOGUE.length);
		expect(CATEGORIES.length).toBe(catalogueParCategorie().length);
	});

	test("un filtre de famille accepte le libellé comme la valeur brute", () => {
		const parValeur = catalogueParCategorie("sticker");
		const parLibelle = catalogueParCategorie("Stickers");
		expect(parValeur.length).toBe(1);
		expect(parValeur[0]?.produits.length).toBe(3);
		expect(parLibelle.map((g) => g.categorie)).toEqual(parValeur.map((g) => g.categorie));
	});

	test("une famille inconnue ne renvoie rien plutôt que tout", () => {
		expect(catalogueParCategorie("peluche")).toEqual([]);
	});
});

describe("champs de l'embed catalogue — les trois limites Discord", () => {
	const groupes = catalogueParCategorie();

	test("le catalogue réel passe en entier, sans rien omettre", () => {
		const { champs, omises } = champsCatalogue(groupes, MAX_TOTAL_EMBED - 300);
		expect(omises).toBe(0);
		expect(champs.length).toBe(groupes.length);
		expect(champs.map((c) => c.nom)).toContain(`Stickers (3)`);
	});

	test("la somme des champs reste sous le budget, et chacun sous 1 024", () => {
		const { champs } = champsCatalogue(groupes, MAX_TOTAL_EMBED - 300);
		const total = champs.reduce((n, c) => n + c.nom.length + c.valeur.length, 0);
		expect(total).toBeLessThanOrEqual(MAX_TOTAL_EMBED - 300);
		for (const champ of champs) {
			expect(champ.valeur.length).toBeLessThanOrEqual(MAX_VALEUR_CHAMP);
		}
	});

	test("un budget trop court écarte des familles au lieu de faire échouer l'envoi", () => {
		const { champs, omises } = champsCatalogue(groupes, 400);
		expect(champs.length).toBeGreaterThan(0);
		expect(champs.length).toBeLessThan(groupes.length);
		expect(omises).toBe(groupes.length - champs.length);
		const total = champs.reduce((n, c) => n + c.nom.length + c.valeur.length, 0);
		expect(total).toBeLessThanOrEqual(400);
	});

	test("un budget nul n'affiche rien et le dit, plutôt que de mentir", () => {
		const { champs, omises } = champsCatalogue(groupes, 0);
		expect(champs).toEqual([]);
		expect(omises).toBe(groupes.length);
	});

	test("plus de 25 familles : les 25 premières passent, le reste est compté", () => {
		const gonfle = Array.from({ length: 30 }, (_, i) => ({
			libelle: `Famille ${i}`,
			produits: [CATALOGUE[0] as (typeof CATALOGUE)[number]],
		}));
		const { champs, omises } = champsCatalogue(gonfle, 1_000_000);
		expect(champs.length).toBe(MAX_CHAMPS_EMBED);
		expect(omises).toBe(5);
	});

	test("une famille interminable est coupée au caractère près, pas rejetée", () => {
		const enorme = [
			{
				libelle: "Tout",
				produits: Array.from({ length: 200 }, () => CATALOGUE[0] as (typeof CATALOGUE)[number]),
			},
		];
		const { champs } = champsCatalogue(enorme, MAX_TOTAL_EMBED);
		expect(champs).toHaveLength(1);
		expect(champs[0]!.valeur.length).toBe(MAX_VALEUR_CHAMP);
		expect(champs[0]!.valeur.endsWith("…")).toBe(true);
	});
});

describe("formaterEuros", () => {
	test("les centimes sont affichés, la virgule est française", () => {
		expect(espaces(formaterEuros(2490))).toBe("24,90 €");
		expect(espaces(formaterEuros(250))).toBe("2,50 €");
	});

	test("un montant rond se passe de décimales", () => {
		expect(espaces(formaterEuros(1000))).toBe("10 €");
		expect(espaces(formaterEuros(0))).toBe("0 €");
	});

	test("l'espace avant l'euro est insécable, jamais une espace ordinaire", () => {
		// Mesuré sous Bun 1.4 sur ce VPS : l'ICU embarquée rend U+00A0 pour `fr-FR`,
		// là où d'autres versions rendent l'espace fine U+202F. Le test accepte les
		// deux et refuse l'espace simple — c'est le seul invariant sur lequel une
		// comparaison de chaîne peut s'appuyer.
		const rendu = formaterEuros(990);
		expect(/^9,90[\u00a0\u202f]€$/u.test(rendu)).toBe(true);
		expect(rendu).not.toBe("9,90 €");
		expect(espaces(rendu)).toBe("9,90 €");
	});

	test("le format est identique à celui de la caisse du site", () => {
		for (const cents of [250, 290, 390, 450, 590, 790, 990, 1990, 2490, 7990, 1000]) {
			expect(formaterEuros(cents)).toBe(formatEuros(cents));
		}
	});
});

describe("liens", () => {
	test("la fiche produit pointe sur le site public", () => {
		expect(urlFicheProduit("print-a5-roy-fonteneau")).toBe(
			`${BASE_BOUTIQUE}/shop/print-a5-roy-fonteneau`
		);
	});

	test("une image du catalogue devient une URL absolue", () => {
		expect(urlImageProduit("/RG_roy_LC.webp")).toBe(`${BASE_BOUTIQUE}/RG_roy_LC.webp`);
		expect(urlImageProduit("RG_roy_LC.webp")).toBe(`${BASE_BOUTIQUE}/RG_roy_LC.webp`);
	});

	test("une image déjà absolue n'est pas préfixée deux fois", () => {
		expect(urlImageProduit("https://cdn.rosegriffon.fr/x.webp")).toBe(
			"https://cdn.rosegriffon.fr/x.webp"
		);
	});

	test("la ligne de liste porte le nom, le lien, le prix et le stock", () => {
		const carte = trouverProduit("carte-trading-roy-foil");
		const ligne = espaces(ligneCatalogue(carte as NonNullable<typeof carte>));
		expect(ligne).toBe(
			`[Carte Trading · Roy Fonteneau (Foil)](${BASE_BOUTIQUE}/shop/carte-trading-roy-foil) — 4,90 € · Édition limitée`
		);
	});

	test("les libellés de stock sont en français", () => {
		expect(libelleStock("in-stock")).toBe("En stock");
		expect(libelleStock("low-stock")).toBe("Derniers exemplaires");
		expect(libelleStock("preorder")).toBe("Précommande");
		expect(libelleStock(null)).toBeNull();
	});
});

describe("recherche", () => {
	test("une saisie vide propose le début du catalogue", () => {
		expect(chercherProduits("").length).toBe(Math.min(25, CATALOGUE.length));
		expect(chercherProduits(null, 3).length).toBe(3);
	});

	test("les accents et la casse n'empêchent pas de trouver", () => {
		expect(normaliser("Édition Limitée")).toBe("edition limitee");
		const trouve = chercherProduits("gaelle");
		expect(trouve[0]?.slug).toBe("print-a5-gaelle-la-goatte");
	});

	test("un début de nom passe devant une correspondance interne", () => {
		const resultats = chercherProduits("sticker");
		expect(resultats[0]?.nom.toLowerCase().startsWith("sticker")).toBe(true);
	});

	test("une étiquette suffit à faire remonter un produit", () => {
		const resultats = chercherProduits("achillea");
		expect(resultats.map((p) => p.slug)).toContain("affiche-a2-achillea-rose-griffon");
	});

	test("le nombre de propositions reste sous la limite Discord", () => {
		expect(chercherProduits("e", 25).length).toBeLessThanOrEqual(25);
	});

	test("une recherche sans réponse renvoie une liste vide", () => {
		expect(chercherProduits("zzzzz")).toEqual([]);
	});
});

describe("trouverProduit", () => {
	test("le slug exact gagne", () => {
		expect(trouverProduit("badge-brode-rose-griffon")?.nom).toBe(
			"Grand Badge brodé · Rose Griffon"
		);
	});

	test("le nom complet tapé à la main fonctionne aussi", () => {
		expect(trouverProduit("Grand Badge brodé · Rose Griffon")?.slug).toBe(
			"badge-brode-rose-griffon"
		);
	});

	test("un fragment retombe sur le meilleur résultat de recherche", () => {
		expect(trouverProduit("t-shirt")?.slug).toBe("tshirt-rose-griffon-edition");
	});

	test("une référence vide ou inconnue ne renvoie rien", () => {
		expect(trouverProduit("")).toBeNull();
		expect(trouverProduit(null)).toBeNull();
		expect(trouverProduit("   ")).toBeNull();
		expect(trouverProduit("mug licorne")).toBeNull();
	});
});

describe("statuts Patreon", () => {
	test("les quatre statuts de l'API sont classés", () => {
		expect(classerStatutPatron("active_patron")).toBe("actif");
		expect(classerStatutPatron("former_patron")).toBe("ancien");
		expect(classerStatutPatron("declined_patron")).toBe("refuse");
		expect(classerStatutPatron(null)).toBe("abonne");
	});

	test("la casse et les espaces parasites ne changent pas le classement", () => {
		expect(classerStatutPatron("  Active_Patron ")).toBe("actif");
	});

	test("un statut inconnu ne casse rien : c'est un abonné", () => {
		expect(classerStatutPatron("zombie_patron")).toBe("abonne");
		expect(libelleStatutPatron(classerStatutPatron("zombie_patron"))).toBe(
			"Abonné sans engagement"
		);
	});
});

describe("agrégation des paliers", () => {
	test("le relevé réel donne 1 palier et 3 soutiens actifs", () => {
		const paliers = agregerPaliers(ADHESIONS_REELLES);
		expect(paliers.length).toBe(1);
		expect(paliers[0]?.titre).toBe(PALIER_EVANS);
		expect(paliers[0]?.soutiens).toBe(3);
		expect(paliers[0]?.montantCents).toBe(1450);
	});

	test("les anciens soutiens et les abonnés n'occupent plus de palier", () => {
		expect(compterParStatut(ADHESIONS_REELLES)).toEqual({
			abonne: 4,
			actif: 3,
			ancien: 4,
			refuse: 0,
		});
	});

	test("les paliers sortent du plus cher au moins cher", () => {
		const paliers = agregerPaliers([
			adhesion({
				patron_status: "active_patron",
				tier_amounts_cents: [500],
				tier_titles: ["Bronze"],
			}),
			adhesion({ patron_status: "active_patron", tier_amounts_cents: [2000], tier_titles: ["Or"] }),
			adhesion({ patron_status: "active_patron", tier_amounts_cents: [2000], tier_titles: ["Or"] }),
		]);
		expect(paliers.map((p) => p.titre)).toEqual(["Or", "Bronze"]);
		expect(paliers[0]?.soutiens).toBe(2);
	});

	test("une adhésion à plusieurs paliers compte dans chacun", () => {
		const paliers = agregerPaliers([
			adhesion({
				patron_status: "active_patron",
				tier_amounts_cents: [1000, 300],
				tier_titles: ["Or", "Bonus"],
			}),
		]);
		expect(paliers.map((p) => [p.titre, p.soutiens])).toEqual([
			["Or", 1],
			["Bonus", 1],
		]);
	});

	test("les bigint rendus en chaîne par Postgres sont bien lus", () => {
		const paliers = agregerPaliers([
			adhesion({
				patron_status: "active_patron",
				tier_amounts_cents: ["1450"],
				tier_titles: [PALIER_EVANS],
			}),
		]);
		expect(paliers[0]?.montantCents).toBe(1450);
	});

	test("un palier sans titre ou une adhésion sans palier sont ignorés", () => {
		expect(
			agregerPaliers([
				adhesion({ patron_status: "active_patron", tier_amounts_cents: [], tier_titles: [] }),
				adhesion({ patron_status: "active_patron", tier_amounts_cents: [0], tier_titles: ["  "] }),
				adhesion({ patron_status: "active_patron", tier_amounts_cents: null, tier_titles: null }),
			])
		).toEqual([]);
	});

	test("aucune adhésion : aucun palier, aucune exception", () => {
		expect(agregerPaliers([])).toEqual([]);
		expect(compterParStatut([])).toEqual({ abonne: 0, actif: 0, ancien: 0, refuse: 0 });
	});
});

describe("mise en forme d'un palier", () => {
	test("le montant mensuel accompagne le décompte", () => {
		expect(espaces(lignePalier({ montantCents: 1450, soutiens: 3, titre: PALIER_EVANS }))).toBe(
			`**${PALIER_EVANS}** — 3 soutiens · 14,50 €/mois`
		);
	});

	test("un palier gratuit n'affiche pas « 0 €/mois »", () => {
		expect(lignePalier({ montantCents: 0, soutiens: 1, titre: "Free" })).toBe(
			"**Free** — 1 soutien"
		);
		expect(lignePalier({ montantCents: null, soutiens: 2, titre: "Free" })).toBe(
			"**Free** — 2 soutiens"
		);
	});

	test("le pluriel des soutiens est accordé", () => {
		expect(accorderSoutiens(0)).toBe("aucun soutien");
		expect(accorderSoutiens(1)).toBe("1 soutien");
		expect(accorderSoutiens(7)).toBe("7 soutiens");
	});
});

describe("dates et cadence", () => {
	test("les dates sortent en français, sans heure", () => {
		expect(formaterDateFr("2026-10-20")).toBe("20 octobre 2026");
		expect(formaterDateFr(new Date("2025-05-11T00:00:00Z"))).toBe("11 mai 2025");
	});

	test("une date absente ou invalide ne produit pas « Invalid Date »", () => {
		expect(formaterDateFr(null)).toBeNull();
		expect(formaterDateFr("")).toBeNull();
		expect(formaterDateFr("pas une date")).toBeNull();
	});

	test("la cadence Patreon est traduite", () => {
		expect(formaterCadence(1)).toBe("mensuel");
		expect(formaterCadence(12)).toBe("annuel");
		expect(formaterCadence(null)).toBeNull();
		expect(formaterCadence(3)).toBeNull();
	});

	test("l'issue du dernier prélèvement est en français", () => {
		expect(libellePrelevement("Paid")).toBe("réglé");
		expect(libellePrelevement("Declined")).toBe("refusé");
		expect(libellePrelevement(null)).toBeNull();
		expect(libellePrelevement("  ")).toBeNull();
	});

	test("une issue inconnue est rendue telle quelle plutôt que masquée", () => {
		expect(libellePrelevement("Something")).toBe("Something");
	});
});

describe("fiche personnelle d'un soutien", () => {
	test("un soutien actif voit son palier, son engagement et ses dates", () => {
		const champs = resumerAdhesion(ADHESIONS_REELLES[0] as AdhesionPatreon);
		const parNom = new Map(champs.map((c) => [c.nom, espaces(c.valeur)]));
		expect(parNom.get("Statut")).toBe("Soutien actif");
		expect(parNom.get("Palier")).toBe(PALIER_EVANS);
		expect(parNom.get("Engagement en cours")).toBe("145,42 € (annuel)");
		expect(parNom.get("Soutien cumulé")).toBe("145,42 €");
		expect(parNom.get("Depuis le")).toBe("20 octobre 2025");
		expect(parNom.get("Prochain prélèvement")).toBe("20 octobre 2026");
		expect(parNom.get("Dernier prélèvement")).toBe("20 octobre 2025 · réglé");
	});

	test("un prélèvement refusé n'est pas maquillé, mais ne change pas le statut", () => {
		const refuse = ADHESIONS_REELLES[3] as AdhesionPatreon;
		const parNom = new Map(resumerAdhesion(refuse).map((c) => [c.nom, espaces(c.valeur)]));
		expect(parNom.get("Statut")).toBe("Ancien soutien");
		expect(parNom.get("Dernier prélèvement")).toBe("10 mars 2026 · refusé");
	});

	test("un ancien soutien n'annonce pas de prochain prélèvement", () => {
		const ancien = adhesion({
			lifetime_support_cents: 9122,
			next_charge_date: "2026-03-17",
			patron_status: "former_patron",
			pledge_start: "2025-09-17",
		});
		const parNom = new Map(resumerAdhesion(ancien).map((c) => [c.nom, espaces(c.valeur)]));
		expect(parNom.get("Statut")).toBe("Ancien soutien");
		expect(parNom.get("Palier")).toBe("Free");
		expect(parNom.has("Prochain prélèvement")).toBe(false);
		expect(parNom.has("Engagement en cours")).toBe(false);
		expect(parNom.get("Soutien cumulé")).toBe("91,22 €");
	});

	test("un abonné sans engagement n'affiche aucun montant", () => {
		const parNom = new Map(resumerAdhesion(adhesion()).map((c) => [c.nom, c.valeur]));
		expect(parNom.get("Statut")).toBe("Abonné sans engagement");
		expect(parNom.has("Engagement en cours")).toBe(false);
		expect(parNom.has("Soutien cumulé")).toBe(false);
	});

	test("essai gratuit et abonnement offert sont signalés", () => {
		const champs = resumerAdhesion(
			adhesion({ is_free_trial: true, is_gifted: true, patron_status: "active_patron" })
		);
		expect(champs[0]?.valeur).toBe("Soutien actif · essai gratuit · abonnement offert");
	});

	test("aucun champ ne peut porter une donnée personnelle", () => {
		for (const ligne of ADHESIONS_REELLES) {
			const rendu = JSON.stringify(resumerAdhesion(ligne));
			expect(rendu).not.toContain("@");
			expect(rendu.toLowerCase()).not.toContain("mail");
			expect(rendu.toLowerCase()).not.toContain("adresse");
		}
	});

	test("les paliers d'une adhésion vide restent lisibles", () => {
		expect(paliersDeLAdhesion(adhesion({ tier_titles: null }))).toBe("Aucun palier");
		expect(paliersDeLAdhesion(adhesion({ tier_titles: ["Or", "Bonus"] }))).toBe("Or · Bonus");
	});
});
