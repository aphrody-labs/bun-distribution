/**
 * Tests du noyau des commandes de communauté.
 *
 * Toutes les valeurs ci-dessous sont des relevés réels du 13/8/2026 :
 * les 3 articles publiés (1 `azalee`, 2 `website`), les 5 entrées de
 * `/api/calendar-events` du site (toutes passées), les 7 lignes actives de
 * `stream_schedules` (`end_time` NULL sur les 7), les rôles réels du serveur
 * (93 lignes de `discord_roles`, 34 sur le membre le plus décoré) et les
 * 10 équipes de `team_members`.
 */
import { describe, expect, test } from "bun:test";

import {
	APPS_ARTICLE,
	CLES_PII_PROFIL,
	EQUIPES,
	EQUIPE_PAR_DEFAUT,
	SITES_ARTICLE,
	ancienneteJours,
	appsDemandees,
	assainirProfil,
	choisirEvenements,
	dateCourte,
	estAVenir,
	finEffective,
	formaterPlageEvenement,
	grouperParJour,
	heureCourte,
	horodatageRelatif,
	indexerRoles,
	libelleAnciennete,
	libelleEquipe,
	libelleJour,
	libellePortee,
	ligneMembreDiscord,
	ligneStream,
	listerRoles,
	motifRecherche,
	nettoyerHtml,
	nomAffiche,
	normaliserEvenement,
	plageHoraire,
	rechercheExploitable,
	resoudreRoles,
	resumeArticle,
	siteArticle,
	sousTitreEquipe,
	urlArticle,
	versDate,
	type EvenementCalendrier,
	type LigneArticle,
	type LigneMembreDiscord,
	type LigneStream,
	type RoleDiscord,
} from "./communaute-format";

/** Instant de référence des tests : le jour du relevé. */
const MAINTENANT = new Date("2026-08-13T12:00:00Z");

// ─── Articles ──────────────────────────────────────────────────────────────

describe("articles — une table, deux sites", () => {
	test("les deux `app` réellement présentes en base sont décrites", () => {
		expect([...APPS_ARTICLE]).toEqual(["website", "azalee"]);
		expect(SITES_ARTICLE.website.segment).toBe("chroniques");
		expect(SITES_ARTICLE.azalee.segment).toBe("news");
	});

	test("URL publique d'un article du site (vérifiée 200)", () => {
		expect(
			urlArticle("website", "victory-road-france-un-pigeonnage-communautaire-qui-termine-bien")
		).toBe(
			"https://rosegriffon.fr/chroniques/victory-road-france-un-pigeonnage-communautaire-qui-termine-bien"
		);
	});

	test("URL publique d'un article du wiki (vérifiée 200)", () => {
		expect(urlArticle("azalee", "critique-communautaire-de-inazuma-eleven-victory-road")).toBe(
			"https://azalee.rosegriffon.fr/news/critique-communautaire-de-inazuma-eleven-victory-road"
		);
	});

	test("une `app` inconnue ou nulle retombe sur le site principal", () => {
		expect(siteArticle(null).app).toBe("website");
		expect(siteArticle("achillea").app).toBe("website");
	});

	test("l'option `site` sélectionne une app, ou les deux par défaut", () => {
		expect(appsDemandees("azalee")).toEqual(["azalee"]);
		expect(appsDemandees("rosegriffon")).toEqual(["website"]);
		expect(appsDemandees(undefined)).toEqual(["website", "azalee"]);
		expect(appsDemandees("nimportequoi")).toEqual(["website", "azalee"]);
	});

	test("libellé de portée", () => {
		expect(libellePortee(["azalee"])).toBe("Azalée");
		expect(libellePortee(["website", "azalee"])).toBe("rosegriffon.fr + Azalée");
	});
});

describe("nettoyerHtml", () => {
	test("retire les balises et rend les entités", () => {
		expect(nettoyerHtml("<p>Victory&nbsp;Road &amp; les <b>Rose Griffon</b></p>")).toBe(
			"Victory Road & les Rose Griffon"
		);
	});

	test("les blocs script et style disparaissent avec leur contenu", () => {
		expect(nettoyerHtml("<style>.a{color:red}</style><p>Texte</p>")).toBe("Texte");
		expect(nettoyerHtml("<script>alert('x')</script>Suite")).toBe("Suite");
	});

	test("les fins de bloc deviennent des espaces, pas des collages", () => {
		expect(nettoyerHtml("<p>Un</p><p>Deux</p>")).toBe("Un Deux");
		expect(nettoyerHtml("Un<br>Deux")).toBe("Un Deux");
	});

	test("une entrée vide ou nulle donne une chaîne vide", () => {
		expect(nettoyerHtml(null)).toBe("");
		expect(nettoyerHtml("")).toBe("");
		expect(nettoyerHtml("   ")).toBe("");
	});

	test("les apostrophes typographiques encodées reviennent", () => {
		expect(nettoyerHtml("L&#39;équipe &hellip;")).toBe("L'équipe …");
	});
});

describe("resumeArticle", () => {
	const base: LigneArticle = {
		title: "Mise à jour du site",
		slug: "mise-a-jour-du-site",
		excerpt: null,
		content: null,
		category: "coulisses",
		app: "website",
		published_at: "2026-04-01T12:00:00+00:00",
	};

	test("l'excerpt prime quand il existe", () => {
		expect(resumeArticle({ ...base, excerpt: "Un résumé court." })).toBe("Un résumé court.");
	});

	test("sans excerpt, on retombe sur le contenu nettoyé", () => {
		expect(resumeArticle({ ...base, content: "<p>Le <i>site</i> évolue.</p>" })).toBe(
			"Le site évolue."
		);
	});

	test("sans excerpt ni contenu, une chaîne vide (jamais « null »)", () => {
		expect(resumeArticle(base)).toBe("");
	});

	test("le texte est borné et suffixé d'une ellipse", () => {
		const long = "a".repeat(400);
		const resume = resumeArticle({ ...base, excerpt: long }, 20);
		expect(resume).toHaveLength(20);
		expect(resume.endsWith("…")).toBe(true);
	});

	test("un texte plus court que la borne n'est pas touché", () => {
		expect(resumeArticle({ ...base, excerpt: "court" }, 20)).toBe("court");
	});
});

// ─── Dates ─────────────────────────────────────────────────────────────────

describe("dates", () => {
	test("versDate accepte chaîne, Date et rejette l'invalide", () => {
		expect(versDate("2026-06-02T14:49:59Z")?.getUTCFullYear()).toBe(2026);
		expect(versDate(new Date(0))?.getTime()).toBe(0);
		expect(versDate("pas une date")).toBeNull();
		expect(versDate(null)).toBeNull();
		expect(versDate("")).toBeNull();
	});

	test("dateCourte rend le jour parisien de l'article Azalée", () => {
		expect(dateCourte("2026-06-02T14:49:59.04+00:00")).toBe("02 juin 2026");
	});

	test("un instant UTC juste avant minuit bascule au jour suivant à Paris", () => {
		// 22:30 UTC = 00:30 le lendemain en heure d'été française.
		expect(dateCourte("2026-06-02T22:30:00Z")).toBe("03 juin 2026");
	});

	test("une date absente ne casse pas l'embed", () => {
		expect(dateCourte(null)).toBe("date inconnue");
		expect(horodatageRelatif(null)).toBeNull();
	});

	test("horodatageRelatif produit la syntaxe Discord en secondes", () => {
		expect(horodatageRelatif("2026-08-13T12:00:00Z")).toBe("<t:1786622400:R>");
	});
});

// ─── Streams ───────────────────────────────────────────────────────────────

describe("planning des streams", () => {
	test("heureCourte coupe les secondes de Postgres", () => {
		expect(heureCourte("21:00:00")).toBe("21:00");
		expect(heureCourte("9:05:00")).toBe("09:05");
		expect(heureCourte(null)).toBeNull();
		expect(heureCourte("plus tard")).toBeNull();
	});

	test("les 7 lignes réelles n'ont pas de fin : on n'invente pas de tiret", () => {
		expect(plageHoraire("21:00:00", null)).toBe("à partir de 21:00");
		expect(plageHoraire("21:00:00", "23:00:00")).toBe("21:00 → 23:00");
		expect(plageHoraire(null, "23:00:00")).toBe("jusqu'à 23:00");
		expect(plageHoraire(null, null)).toBe("horaire à confirmer");
	});

	test("ligne d'un stream réel", () => {
		const row: LigneStream = {
			day_of_week: 1,
			streamer_name: "Ishido",
			start_time: "21:00:00",
			end_time: null,
			category: "Stream",
			notes: null,
		};
		expect(ligneStream(row)).toBe("• **Ishido** · à partir de 21:00 · *Stream*");
	});

	test("une note est rendue sur sa propre ligne", () => {
		const row: LigneStream = {
			day_of_week: 1,
			streamer_name: "Ishido",
			start_time: "21:00:00",
			end_time: null,
			category: null,
			notes: "Une semaine sur deux",
		};
		expect(ligneStream(row)).toBe("• **Ishido** · à partir de 21:00\n  Une semaine sur deux");
	});

	test("la semaine commence lundi, pas dimanche", () => {
		const lignes: LigneStream[] = [0, 6, 1].map((j) => ({
			day_of_week: j,
			streamer_name: `S${j}`,
			start_time: "20:00:00",
			end_time: null,
			category: null,
			notes: null,
		}));
		expect(grouperParJour(lignes).map((s) => s.libelle)).toEqual(["Lundi", "Samedi", "Dimanche"]);
	});

	test("les deux streams du samedi réel sont triés par heure", () => {
		const lignes: LigneStream[] = [
			{
				day_of_week: 6,
				streamer_name: "Shozuma",
				start_time: "23:00:00",
				end_time: null,
				category: "Stream",
				notes: null,
			},
			{
				day_of_week: 6,
				streamer_name: "Bri",
				start_time: "21:00:00",
				end_time: null,
				category: "Stream",
				notes: null,
			},
		];
		const sections = grouperParJour(lignes);
		expect(sections).toHaveLength(1);
		expect(sections[0]!.lignes.map((l) => l.streamer_name)).toEqual(["Bri", "Shozuma"]);
	});

	test("un jour hors bornes reste lisible", () => {
		expect(libelleJour(9)).toBe("Jour inconnu");
	});
});

// ─── Événements ────────────────────────────────────────────────────────────

/** Les 5 entrées réelles de `/api/calendar-events` (13/8/2026). */
const AGENDA_REEL: EvenementCalendrier[] = [
	{
		id: "7a1orru6rgblrj68t0kn9ajh9n",
		summary: "Epitanime",
		location: "Kremlin-Bicètre, 94270 Le Kremlin-Bicêtre, France",
		start: { date: "2025-05-17" },
		end: { date: "2025-05-19" },
	},
	{
		id: "60o6ac9j6di68bb2cpgmab9k6hi36b9o75imcbb674p3acb6c5ij0oj360",
		summary: "Japan Expo",
		description: "Meet-up",
		location: "Paris, France",
		start: { date: "2025-07-03" },
		end: { date: "2025-07-07" },
	},
	{
		id: "4bk36vfqhhgu1mj32c6e1co28q",
		summary: "Inabikari",
		start: { dateTime: "2025-10-26T13:00:00+01:00", timeZone: "Europe/Paris" },
		end: { dateTime: "2025-10-26T22:00:00+01:00", timeZone: "Europe/Paris" },
	},
	{
		id: "47v97u36qv78v7a35bc7vg6d12",
		summary: "Japan Touch Lyon",
		description: "Meet-up",
		location: "Lyon, France",
		start: { date: "2025-11-29" },
		end: { date: "2025-12-01" },
	},
	{
		id: "3u6tapcblpgis98cskho2ks0hg",
		summary: "Epitanime -  La nocturne Saint Valentin 2026",
		location: "Kremlin-Bicètre, 94270 Le Kremlin-Bicêtre, France",
		start: { date: "2026-02-21" },
		end: { date: "2026-02-23" },
	},
];

function agendaNormalise() {
	return AGENDA_REEL.map(normaliserEvenement).filter((e) => e !== null);
}

describe("événements de l'agenda", () => {
	test("les 5 entrées réelles se normalisent toutes", () => {
		expect(agendaNormalise()).toHaveLength(5);
	});

	test("journée entière et événement horaire sont distingués", () => {
		const liste = agendaNormalise();
		expect(liste[0]!.journeeEntiere).toBe(true);
		expect(liste[2]!.journeeEntiere).toBe(false);
	});

	test("une entrée sans début est écartée, pas rendue vide", () => {
		expect(normaliserEvenement({ summary: "Sans date" })).toBeNull();
		expect(
			normaliserEvenement({ summary: "Bancale", start: { date: "n'importe quoi" } })
		).toBeNull();
	});

	test("un titre absent reçoit un libellé, jamais « undefined »", () => {
		expect(normaliserEvenement({ start: { date: "2026-09-01" } })?.titre).toBe(
			"Événement Rose Griffon"
		);
	});

	test("la fin d'une journée entière est exclusive : Japan Expo finit le 6, pas le 7", () => {
		const japan = agendaNormalise()[1]!;
		expect(formaterPlageEvenement(japan)).toBe("du 03 juillet 2025 au 06 juillet 2025");
	});

	test("une journée entière d'un seul jour ne s'affiche pas en plage", () => {
		const solo = normaliserEvenement({
			summary: "Réunion",
			start: { date: "2026-09-01" },
			end: { date: "2026-09-02" },
		})!;
		expect(formaterPlageEvenement(solo)).toBe("le 01 septembre 2026");
	});

	test("un événement horaire du même jour affiche l'heure de fin seule", () => {
		const inabikari = agendaNormalise()[2]!;
		expect(formaterPlageEvenement(inabikari)).toBe("le 26 octobre 2025 à 13:00 → 22:00");
	});

	test("sans fin, seule la date de début est rendue", () => {
		const sansFin = normaliserEvenement({
			summary: "Live",
			start: { dateTime: "2026-09-01T20:00:00+02:00" },
		})!;
		expect(formaterPlageEvenement(sansFin)).toBe("le 01 septembre 2026 à 20:00");
		expect(finEffective(sansFin).getTime()).toBe(sansFin.debut.getTime());
	});

	test("les 5 événements réels sont tous passés au 13/8/2026", () => {
		expect(agendaNormalise().filter((e) => estAVenir(e, MAINTENANT))).toHaveLength(0);
	});

	test("« à venir » sans rien à venir bascule sur les derniers passés, et le signale", () => {
		const choix = choisirEvenements(agendaNormalise(), "a-venir", 3, MAINTENANT);
		expect(choix.repli).toBe(true);
		expect(choix.periode).toBe("passes");
		expect(choix.total).toBe(5);
		expect(choix.evenements.map((e) => e.titre)).toEqual([
			"Epitanime -  La nocturne Saint Valentin 2026",
			"Japan Touch Lyon",
			"Inabikari",
		]);
	});

	test("un événement à venir désactive le repli et passe en tête", () => {
		const futur = normaliserEvenement({
			summary: "Japan Expo 2026",
			start: { date: "2026-09-10" },
			end: { date: "2026-09-14" },
		})!;
		const choix = choisirEvenements([...agendaNormalise(), futur], "a-venir", 5, MAINTENANT);
		expect(choix.repli).toBe(false);
		expect(choix.periode).toBe("a-venir");
		expect(choix.evenements.map((e) => e.titre)).toEqual(["Japan Expo 2026"]);
	});

	test("« passés » est explicite : ni repli, ni ordre croissant", () => {
		const choix = choisirEvenements(agendaNormalise(), "passes", 2, MAINTENANT);
		expect(choix.repli).toBe(false);
		expect(choix.evenements.map((e) => e.titre)).toEqual([
			"Epitanime -  La nocturne Saint Valentin 2026",
			"Japan Touch Lyon",
		]);
	});

	test("« tous » rend l'agenda entier, du plus récent au plus ancien", () => {
		const choix = choisirEvenements(agendaNormalise(), "tous", 99, MAINTENANT);
		expect(choix.evenements.map((e) => e.titre)).toEqual([
			"Epitanime -  La nocturne Saint Valentin 2026",
			"Japan Touch Lyon",
			"Inabikari",
			"Japan Expo",
			"Epitanime",
		]);
	});

	test("un agenda vide ne lève pas et ne prétend pas replier", () => {
		const choix = choisirEvenements([], "a-venir", 5, MAINTENANT);
		expect(choix.evenements).toHaveLength(0);
		expect(choix.total).toBe(0);
		expect(choix.repli).toBe(true);
	});

	test("une limite nulle ou négative rend quand même un événement", () => {
		expect(choisirEvenements(agendaNormalise(), "tous", 0, MAINTENANT).evenements).toHaveLength(1);
	});

	test("un événement en cours compte comme à venir", () => {
		const enCours = normaliserEvenement({
			summary: "En cours",
			start: { dateTime: "2026-08-13T09:00:00Z" },
			end: { dateTime: "2026-08-13T18:00:00Z" },
		})!;
		expect(estAVenir(enCours, MAINTENANT)).toBe(true);
	});
});

// ─── Vie privée ────────────────────────────────────────────────────────────

describe("profils — barrière de vie privée", () => {
	/**
	 * Colonnes que le rôle `anon` a le droit de lire, relevées en base le
	 * 13/8/2026 (`information_schema.column_privileges`). Tout le reste de
	 * `profiles` est fermé, donc doit figurer dans `CLES_PII_PROFIL`.
	 */
	const COLONNES_PUBLIQUES = [
		"avatar_url",
		"badges",
		"banner_url",
		"bio",
		"discord_id",
		"id",
		"role",
		"twitter_handle",
		"updated_at",
		"username",
		"website",
	];

	test("les colonnes fermées au rôle `anon` sont toutes listées", () => {
		for (const clef of [
			"email",
			"full_name",
			"address_line1",
			"address_line2",
			"city",
			"postal_code",
			"country",
			"patreon_id",
		]) {
			expect(CLES_PII_PROFIL).toContain(clef);
		}
	});

	test("aucune colonne publique n'a été fermée par excès de zèle", () => {
		for (const clef of COLONNES_PUBLIQUES) {
			expect(CLES_PII_PROFIL).not.toContain(clef);
		}
	});

	test("assainirProfil retire e-mail, nom complet et adresse postale, garde le reste", () => {
		const propre = assainirProfil({
			username: "yoyo__goat",
			full_name: "Prénom Nom",
			email: "prive@example.com",
			address_line1: "1 rue de la Paix",
			address_line2: null,
			city: "Paris",
			postal_code: "75002",
			country: "FR",
			patreon_id: "42",
			role: "superadmin",
			discord_id: "123",
		});
		expect(propre).toEqual({
			username: "yoyo__goat",
			role: "superadmin",
			discord_id: "123",
		});
		expect(JSON.stringify(propre)).not.toContain("example.com");
		expect(JSON.stringify(propre)).not.toContain("75002");
		expect(JSON.stringify(propre)).not.toContain("Prénom Nom");
	});

	test("un profil déjà propre traverse sans perte", () => {
		expect(assainirProfil({ username: "kolti", bio: null })).toEqual({
			username: "kolti",
			bio: null,
		});
	});
});

// ─── Rôles et membres ──────────────────────────────────────────────────────

/** Extrait réel de `discord_roles` (positions et noms d'origine). */
const ROLES_REELS: RoleDiscord[] = [
	{ role_id: "1089154031353610335", name: "UnbelievaBoat", position: 30 },
	{ role_id: "1089171148287250463", name: "Booster Riche", position: 67 },
	{ role_id: "1089273878674690090", name: "Médaille Traduction", position: 78 },
];

describe("rôles Discord", () => {
	const index = indexerRoles(ROLES_REELS);

	test("les noms sortent du plus haut au plus bas, comme dans Discord", () => {
		const resolus = resoudreRoles(
			["1089154031353610335", "1089273878674690090", "1089171148287250463"],
			index
		);
		expect(resolus.map((r) => r.name)).toEqual([
			"Médaille Traduction",
			"Booster Riche",
			"UnbelievaBoat",
		]);
	});

	test("un identifiant inconnu est ignoré plutôt qu'affiché brut", () => {
		expect(resoudreRoles(["999", "1089154031353610335"], index).map((r) => r.name)).toEqual([
			"UnbelievaBoat",
		]);
	});

	test("aucun rôle ne lève pas", () => {
		expect(resoudreRoles(null, index)).toEqual([]);
		expect(resoudreRoles([], index)).toEqual([]);
	});

	test("un membre à 34 rôles tient sous les 1 024 caractères d'un champ", () => {
		const beaucoup: RoleDiscord[] = Array.from({ length: 34 }, (_, i) => ({
			role_id: String(i),
			name: `Rôle numéro ${i} au nom volontairement long`,
			position: 100 - i,
		}));
		const rendu = listerRoles(beaucoup);
		expect(rendu).toContain("… +22");
		expect(rendu.length).toBeLessThan(1024);
	});

	test("sans rôle, on écrit « aucun »", () => {
		expect(listerRoles([])).toBe("aucun");
	});

	test("juste sous la borne, pas de « +N »", () => {
		expect(listerRoles(ROLES_REELS, 3)).toBe("UnbelievaBoat, Booster Riche, Médaille Traduction");
	});
});

describe("membres", () => {
	const kolti: LigneMembreDiscord = {
		discord_id: "299502648317444096",
		username: "koltilasko",
		display_name: "Kolti",
		nickname: null,
		avatar_url: null,
		roles: Array.from({ length: 20 }, (_, i) => String(i)),
		joined_at: "2023-02-08T21:26:01.345+00:00",
		premium_since: null,
		left_at: null,
	};

	test("le surnom de serveur prime sur le nom affiché, puis sur le pseudo", () => {
		expect(nomAffiche({ nickname: "Kolt", display_name: "Kolti", username: "koltilasko" })).toBe(
			"Kolt"
		);
		expect(nomAffiche(kolti)).toBe("Kolti");
		expect(nomAffiche({ username: "koltilasko" })).toBe("koltilasko");
		expect(nomAffiche({})).toBe("Membre inconnu");
	});

	test("les blancs seuls ne comptent pas pour un nom", () => {
		expect(nomAffiche({ nickname: "   ", display_name: "Kolti" })).toBe("Kolti");
	});

	test("ancienneté d'un membre réel arrivé le 08/2/2023", () => {
		const jours = ancienneteJours(kolti.joined_at, MAINTENANT);
		expect(jours).toBe(1281);
		expect(libelleAnciennete(jours)).toBe("3 ans et 6 mois");
	});

	test("libellés d'ancienneté aux paliers", () => {
		expect(libelleAnciennete(null)).toBe("inconnue");
		expect(libelleAnciennete(1)).toBe("1 jour");
		expect(libelleAnciennete(12)).toBe("12 jours");
		expect(libelleAnciennete(150)).toBe("4 mois");
		expect(libelleAnciennete(370)).toBe("1 an");
	});

	test("une date d'arrivée manquante ou future ne donne jamais de négatif", () => {
		expect(ancienneteJours(null, MAINTENANT)).toBeNull();
		expect(ancienneteJours("2027-01-01T00:00:00Z", MAINTENANT)).toBe(0);
	});

	test("ligne de recherche, avec et sans compte lié", () => {
		expect(ligneMembreDiscord(kolti, true)).toBe(
			"• **Kolti** · `koltilasko` · 20 rôles · compte lié"
		);
		expect(ligneMembreDiscord({ ...kolti, roles: ["1"] }, false)).toBe(
			"• **Kolti** · `koltilasko` · 1 rôle"
		);
	});

	test("un départ du serveur est dit explicitement", () => {
		expect(ligneMembreDiscord({ ...kolti, left_at: "2026-01-01T00:00:00Z" }, false)).toContain(
			"a quitté le serveur"
		);
	});
});

describe("recherche", () => {
	test("les jokers SQL sont échappés — « % » ne ratisse plus les 2 075 membres", () => {
		expect(motifRecherche("%")).toBe("%\\%%");
		expect(motifRecherche("_")).toBe("%\\_%");
		expect(motifRecherche("a\\b")).toBe("%a\\\\b%");
	});

	test("un terme normal est simplement encadré, sans ses blancs", () => {
		expect(motifRecherche("  kolti ")).toBe("%kolti%");
	});

	test("un terme trop court est refusé avant la requête", () => {
		expect(rechercheExploitable("a")).toBe(false);
		expect(rechercheExploitable("  ")).toBe(false);
		expect(rechercheExploitable(null)).toBe(false);
		expect(rechercheExploitable("ko")).toBe(true);
	});
});

// ─── Équipes ───────────────────────────────────────────────────────────────

describe("équipes", () => {
	test("les 10 équipes de `team_members` sont couvertes", () => {
		expect(EQUIPES).toHaveLength(10);
		for (const id of [
			"bureauteam",
			"assoteam",
			"azaleeteam",
			"achilleateam",
			"loreteam",
			"dessinateurteam",
			"productionteam",
			"socialteam",
			"mediationteam",
			"collabteam",
		]) {
			expect(EQUIPES.some((e) => e.id === id)).toBe(true);
		}
	});

	test("Discord n'accepte que 25 choix : la liste tient largement", () => {
		expect(EQUIPES.length).toBeLessThanOrEqual(25);
	});

	test("le libellé suit la colonne `team_name` de la base", () => {
		expect(libelleEquipe("assoteam")).toBe("Membres de l'Association");
		expect(libelleEquipe(EQUIPE_PAR_DEFAUT)).toBe("Bureau de l'Association");
		expect(libelleEquipe("inconnue")).toBe("Équipe Rose Griffon");
	});

	test("la troncature à 24 cartes est annoncée, filtre ou pas", () => {
		expect(sousTitreEquipe(28, 24, null)).toBe("28 membres — 24 affichés");
		expect(sousTitreEquipe(28, 24, "modérateur")).toBe(
			"Filtré : modérateur · 28 membres — 24 affichés"
		);
	});

	test("sans troncature, on annonce le simple décompte", () => {
		expect(sousTitreEquipe(5, 5, null)).toBe("5 membres");
		expect(sousTitreEquipe(1, 1, null)).toBe("1 membre");
	});

	test("un filtre vide n'ajoute pas de mention parasite", () => {
		expect(sousTitreEquipe(9, 9, "  ")).toBe("9 membres");
	});
});
