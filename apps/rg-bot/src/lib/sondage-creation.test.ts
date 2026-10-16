/**
 * Tests du noyau de CRÉATION d'un sondage.
 *
 * Aucun accès Discord, aucun accès base : tout ce qui décide de la validité
 * d'un sondage se teste ici. Les cas d'essai reprennent des choix RÉELS du
 * salon 🧐〡sondages (sondage `3e501896`, mesuré le 13/8/2026) : un emoji
 * drapeau, un emoji à sélecteur de variante, une barre oblique dans le libellé.
 * Ce sont exactement les formes qui cassent un découpage naïf.
 */
import { describe, expect, test } from "bun:test";

import {
	clotureDe,
	decouperChoix,
	DUREES_PROPOSEES,
	LIMITES_SONDAGE,
	libelleDuree,
	libelleRegleDeVote,
	normaliserDuree,
	preparerSondage,
	referenceMessage,
	separerEmojiDeTete,
} from "./sondage-creation";

describe("découpage des choix", () => {
	test("le point-virgule, la barre verticale et le retour à la ligne séparent", () => {
		expect(decouperChoix("Oui ; Non")).toEqual(["Oui", "Non"]);
		expect(decouperChoix("Oui|Non")).toEqual(["Oui", "Non"]);
		expect(decouperChoix("Oui\nNon")).toEqual(["Oui", "Non"]);
	});

	test("la barre oblique NE sépare PAS : elle relie les deux noms d'un personnage", () => {
		// Sans cette règle, « Goldie Lemmon / Nanobana Kinako » deviendrait deux
		// choix distincts — la moitié des sondages du serveur écrit ses choix
		// ainsi, la localisation française d'un côté, la japonaise de l'autre.
		expect(decouperChoix("Goldie Lemmon / Nanobana Kinako ; Shinohara Raika")).toEqual([
			"Goldie Lemmon / Nanobana Kinako",
			"Shinohara Raika",
		]);
	});

	test("les morceaux vides disparaissent, les espaces sont rognés", () => {
		expect(decouperChoix("  A ;; B ;  ")).toEqual(["A", "B"]);
		expect(decouperChoix("")).toEqual([]);
		expect(decouperChoix(undefined)).toEqual([]);
	});
});

describe("emoji de tête", () => {
	test("un emoji simple devient l'emoji de vote", () => {
		const choix = separerEmojiDeTete("🥞 Goldie Lemmon / Nanobana Kinako");
		expect(choix.emoji).toEqual({ name: "🥞" });
		expect(choix.texte).toBe("Goldie Lemmon / Nanobana Kinako");
	});

	test("un drapeau (deux indicateurs régionaux) n'est pas coupé en deux", () => {
		const choix = separerEmojiDeTete("🇮🇹 Paolo Bianchi / Fidio Aldena");
		expect(choix.emojiTexte).toBe("🇮🇹");
		expect(choix.texte).toBe("Paolo Bianchi / Fidio Aldena");
	});

	test("un emoji à sélecteur de variante garde son sélecteur", () => {
		const choix = separerEmojiDeTete("🕵️ Tori Vanguard / Zaizen Touko");
		expect(choix.emojiTexte).toBe("🕵️");
		expect(choix.texte).toBe("Tori Vanguard / Zaizen Touko");
	});

	test("un emoji personnalisé rend son identifiant, pas son écriture", () => {
		const choix = separerEmojiDeTete("<:IE_hey1:1089276504657117205> Cette émote");
		expect(choix.emoji).toEqual({
			animated: false,
			id: "1089276504657117205",
			name: "IE_hey1",
		});
		expect(choix.texte).toBe("Cette émote");
		const anime = separerEmojiDeTete("<a:danse:1234567890123456789> Bouge");
		expect(anime.emoji?.animated).toBe(true);
	});

	test("un chiffre suivi d'un point n'est PAS un emoji", () => {
		// `\p{Emoji}` matche les chiffres : sans `\p{Extended_Pictographic}`, le
		// « 1 » de « 1. Premier choix » serait promu emoji de vote et le choix
		// s'afficherait « . Premier choix ».
		const choix = separerEmojiDeTete("1. Premier choix");
		expect(choix.emoji).toBeNull();
		expect(choix.texte).toBe("1. Premier choix");
	});

	test("un emoji-touche reste entier", () => {
		expect(separerEmojiDeTete("3️⃣ Trois").emojiTexte).toBe("3️⃣");
	});

	test("un emoji SEUL reste le libellé — un choix sans texte n'existe pas", () => {
		const choix = separerEmojiDeTete("🥞");
		expect(choix.emoji).toBeNull();
		expect(choix.texte).toBe("🥞");
	});
});

describe("durée", () => {
	test("les formes courantes sont comprises", () => {
		expect(normaliserDuree("12h")?.heures).toBe(12);
		expect(normaliserDuree("3j")?.heures).toBe(72);
		expect(normaliserDuree("2 jours")?.heures).toBe(48);
		expect(normaliserDuree("1 semaine")?.heures).toBe(168);
		// Un nombre nu vaut des heures, comme le paramètre de l'API.
		expect(normaliserDuree("48")?.heures).toBe(48);
	});

	test("hors bornes ou illisible ⇒ null", () => {
		expect(normaliserDuree("800h")).toBeNull();
		expect(normaliserDuree("0h")).toBeNull();
		expect(normaliserDuree("33j")).toBeNull();
		expect(normaliserDuree("bientôt")).toBeNull();
		expect(normaliserDuree(undefined)).toBeNull();
	});

	test("le libellé s'accorde et préfère l'unité la plus lisible", () => {
		expect(libelleDuree(1)).toBe("1 heure");
		expect(libelleDuree(6)).toBe("6 heures");
		expect(libelleDuree(24)).toBe("1 jour");
		expect(libelleDuree(72)).toBe("3 jours");
		expect(libelleDuree(168)).toBe("1 semaine");
		expect(libelleDuree(336)).toBe("2 semaines");
	});

	test("toutes les durées proposées tiennent dans les bornes de l'API", () => {
		for (const entree of DUREES_PROPOSEES) {
			expect(entree.heures).toBeGreaterThanOrEqual(LIMITES_SONDAGE.dureeMinHeures);
			expect(entree.heures).toBeLessThanOrEqual(LIMITES_SONDAGE.dureeMaxHeures);
			expect(entree.libelle.length).toBeGreaterThan(0);
		}
	});
});

describe("préparation d'un sondage", () => {
	test("un sondage ordinaire passe, emojis promus", () => {
		const resultat = preparerSondage({
			choix: "🥞 Goldie Lemmon / Nanobana Kinako ; 🌸 Shinohara Raika ; 🐰 Fei Rune",
			duree: "7j",
			multiple: true,
			question: "Quel personnage irait le mieux pour cette émote ?",
		});
		expect(resultat.ok).toBe(true);
		if (!resultat.ok) return;
		expect(resultat.projet.choix).toHaveLength(3);
		expect(resultat.projet.choix[0]?.emoji).toEqual({ name: "🥞" });
		expect(resultat.projet.duree.heures).toBe(168);
		expect(resultat.projet.multiple).toBe(true);
		expect(resultat.avertissements).toEqual([]);
	});

	test("tous les refus sont rendus d'un coup", () => {
		const resultat = preparerSondage({ choix: "Seul", question: "" });
		expect(resultat.ok).toBe(false);
		if (resultat.ok) return;
		expect(resultat.erreurs).toHaveLength(2);
		expect(resultat.erreurs.join(" ")).toContain("question");
		expect(resultat.erreurs.join(" ")).toContain("2 choix");
	});

	test("au-delà de dix choix, on refuse au lieu de tronquer en silence", () => {
		const onze = Array.from({ length: 11 }, (_, index) => `Choix ${index + 1}`).join(" ; ");
		const resultat = preparerSondage({ choix: onze, question: "Trop ?" });
		expect(resultat.ok).toBe(false);
		if (resultat.ok) return;
		expect(resultat.erreurs[0]).toContain(String(LIMITES_SONDAGE.choixMax));
	});

	test("une question trop longue est refusée, avec sa longueur réelle", () => {
		const resultat = preparerSondage({
			choix: "Oui ; Non",
			question: "a".repeat(LIMITES_SONDAGE.longueurQuestion + 1),
		});
		expect(resultat.ok).toBe(false);
		if (resultat.ok) return;
		expect(resultat.erreurs[0]).toContain(String(LIMITES_SONDAGE.longueurQuestion + 1));
	});

	test("un choix trop long est abrégé, et l'abrègement est annoncé", () => {
		const resultat = preparerSondage({
			choix: `${"b".repeat(LIMITES_SONDAGE.longueurChoix + 10)} ; Non`,
			question: "Long ?",
		});
		expect(resultat.ok).toBe(true);
		if (!resultat.ok) return;
		expect(resultat.projet.choix[0]?.texte.length).toBeLessThanOrEqual(
			LIMITES_SONDAGE.longueurChoix
		);
		expect(resultat.avertissements[0]).toContain("abrégé");
	});

	test("une durée incomprise ne bloque pas : défaut de 24 h, et on le dit", () => {
		const resultat = preparerSondage({ choix: "Oui ; Non", duree: "3 jrs", question: "Quand ?" });
		expect(resultat.ok).toBe(true);
		if (!resultat.ok) return;
		expect(resultat.projet.duree.heures).toBe(LIMITES_SONDAGE.dureeDefautHeures);
		expect(resultat.avertissements[0]).toContain("incomprise");
	});

	test("sans durée saisie, aucun avertissement", () => {
		const resultat = preparerSondage({ choix: "Oui ; Non", question: "Quand ?" });
		expect(resultat.ok).toBe(true);
		if (!resultat.ok) return;
		expect(resultat.avertissements).toEqual([]);
	});

	test("la clôture se calcule sur la durée retenue", () => {
		const maintenant = new Date("2026-08-14T12:00:00.000Z");
		const resultat = preparerSondage({ choix: "Oui ; Non", duree: "6h", question: "Quand ?" });
		expect(resultat.ok).toBe(true);
		if (!resultat.ok) return;
		expect(clotureDe(resultat.projet, maintenant).toISOString()).toBe(
			"2026-08-14T18:00:00.000Z"
		);
	});

	test("la règle de vote est dite comme sur le site", () => {
		expect(libelleRegleDeVote({ multiple: false })).toBe("1 choix par personne");
		expect(libelleRegleDeVote({ multiple: true })).toBe("Choix illimités");
	});
});

describe("désignation d'un sondage publié", () => {
	test("un lien de message rend le salon ET le message", () => {
		expect(
			referenceMessage(
				"https://discord.com/channels/1400000000000000000/1155779116612714506/1400000000000000001"
			)
		).toEqual({ messageId: "1400000000000000001", salonId: "1155779116612714506" });
	});

	test("les hôtes des différents clients sont acceptés", () => {
		for (const hote of ["canary.discord.com", "ptb.discord.com", "discordapp.com"]) {
			expect(
				referenceMessage(
					`https://${hote}/channels/1400000000000000000/1155779116612714506/1400000000000000001`
				)
			).not.toBeNull();
		}
	});

	test("un identifiant nu laisse le salon à décider par l'appelante", () => {
		expect(referenceMessage("  1400000000000000001 ")).toEqual({
			messageId: "1400000000000000001",
			salonId: null,
		});
	});

	test("tout le reste est refusé plutôt que deviné", () => {
		expect(referenceMessage("le sondage d'hier")).toBeNull();
		expect(referenceMessage("42")).toBeNull();
		expect(referenceMessage("https://rosegriffon.fr/sondages")).toBeNull();
		expect(referenceMessage(undefined)).toBeNull();
	});
});
