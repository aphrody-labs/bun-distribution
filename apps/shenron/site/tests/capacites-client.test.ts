/**
 * Classement des capacités client.
 *
 * C'est cette table de décision qui coupe les animations, réduit la qualité des
 * images et borne le préchargement. Une erreur ici se voit sur tous les
 * appareils à la fois, et dans le mauvais sens : trop prudent, le site paraît
 * terne sur une machine puissante ; trop optimiste, il rame sur un mobile
 * d'entrée de gamme.
 */
import { describe, expect, test } from "bun:test";
import { classerAppareil, classerReseau, reglagesPour } from "@/lib/capacites-client";

describe("classerAppareil", () => {
	test("la mesure prime sur le déclaratif", () => {
		// 8 cœurs et 8 Go annoncés, mais 30 images par seconde constatées : la
		// machine ne suit pas, quoi qu'elle déclare.
		expect(classerAppareil({ fps: 30, coeurs: 8, memoireGo: 8, densite: 2 })).toBe("leger");
		// Inversement : 4 cœurs déclarés mais 120 Hz tenus, c'est un mobile récent.
		expect(classerAppareil({ fps: 120, coeurs: 4, memoireGo: 4, densite: 3 })).toBe("puissant");
	});

	test("sans mesure, le déclaratif décide", () => {
		expect(classerAppareil({ fps: null, coeurs: 2, memoireGo: 2, densite: 1 })).toBe("leger");
		expect(classerAppareil({ fps: null, coeurs: 16, memoireGo: 8, densite: 2 })).toBe("puissant");
		expect(classerAppareil({ fps: null, coeurs: 6, memoireGo: 4, densite: 2 })).toBe("moyen");
	});

	test("sans rien de déclaré, on reste prudent", () => {
		// Safari : ni cœurs ni mémoire. On ne présume pas de la puissance.
		expect(classerAppareil({ fps: null, coeurs: null, memoireGo: null, densite: 3 })).toBe("moyen");
		expect(classerAppareil({ fps: null, coeurs: null, memoireGo: null, densite: 1 })).toBe("moyen");
	});

	test("60 images par seconde tenues ne suffisent pas à dire « puissant »", () => {
		// C'est la cadence de la plupart des écrans : elle prouve seulement que
		// la machine n'est pas à la peine.
		expect(classerAppareil({ fps: 60, coeurs: 6, memoireGo: 4, densite: 2 })).toBe("moyen");
	});
});

describe("classerReseau", () => {
	test("l'économie de données écrase tout", () => {
		expect(
			classerReseau({ effectiveType: "4g", debitMbps: 50, latenceMs: 10, economieDonnees: true })
		).toBe("lent");
	});

	test("les types déclarés du réseau", () => {
		const base = { debitMbps: null, latenceMs: null, economieDonnees: false };
		expect(classerReseau({ ...base, effectiveType: "slow-2g" })).toBe("lent");
		expect(classerReseau({ ...base, effectiveType: "2g" })).toBe("lent");
		expect(classerReseau({ ...base, effectiveType: "3g" })).toBe("moyen");
		expect(classerReseau({ ...base, effectiveType: "4g" })).toBe("rapide");
	});

	test("le débit mesuré tranche quand le type est absent (Safari, Firefox)", () => {
		const base = { effectiveType: null, latenceMs: null, economieDonnees: false };
		expect(classerReseau({ ...base, debitMbps: 0.8 })).toBe("lent");
		expect(classerReseau({ ...base, debitMbps: 5 })).toBe("moyen");
		expect(classerReseau({ ...base, debitMbps: 40 })).toBe("rapide");
	});

	test("une latence élevée sans débit connu vaut réseau lent", () => {
		expect(
			classerReseau({
				effectiveType: null,
				debitMbps: null,
				latenceMs: 900,
				economieDonnees: false,
			})
		).toBe("lent");
	});

	test("sans aucune information, ni pénalité ni cadeau", () => {
		expect(
			classerReseau({
				effectiveType: null,
				debitMbps: null,
				latenceMs: null,
				economieDonnees: false,
			})
		).toBe("moyen");
	});
});

describe("reglagesPour", () => {
	const base = { animationsReduites: false, economieDonnees: false, densite: 2 } as const;

	test("un choix de l'utilisateur n'est jamais réexaminé", () => {
		const r = reglagesPour({
			...base,
			appareil: "puissant",
			reseau: "rapide",
			animationsReduites: true,
		});
		expect(r.animationsFond).toBe(false);
		expect(r.lectureAuto).toBe(false);
	});

	test("appareil léger : pas d'animation de fond, préchargement minimal", () => {
		const r = reglagesPour({ ...base, appareil: "leger", reseau: "rapide" });
		expect(r.animationsFond).toBe(false);
		expect(r.prechargement).toBe(1);
	});

	test("réseau lent : image bornée à la plus petite largeur autorisée", () => {
		const r = reglagesPour({ ...base, appareil: "puissant", reseau: "lent" });
		expect(r.largeurImageMax).toBe(640);
		expect(r.lectureAuto).toBe(false);
	});

	test("appareil puissant et réseau rapide : tout est ouvert", () => {
		const r = reglagesPour({ ...base, appareil: "puissant", reseau: "rapide" });
		expect(r.animationsFond).toBe(true);
		expect(r.lectureAuto).toBe(true);
		expect(r.prechargement).toBe(6);
		expect(r.largeurImageMax).toBe(1920);
	});

	test("les largeurs proposées existent dans next.config", () => {
		// `deviceSizes` : demander une largeur hors liste rend un 400, pas une
		// image plus petite.
		const autorisees = new Set([640, 828, 1080, 1200, 1920]);
		for (const appareil of ["leger", "moyen", "puissant"] as const) {
			for (const reseau of ["lent", "moyen", "rapide"] as const) {
				for (const densite of [1, 2, 3]) {
					const r = reglagesPour({ ...base, appareil, reseau, densite });
					expect(autorisees.has(r.largeurImageMax)).toBe(true);
				}
			}
		}
	});
});
