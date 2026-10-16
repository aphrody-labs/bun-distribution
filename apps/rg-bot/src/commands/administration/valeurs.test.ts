/**
 * Tests de `commands/administration/valeurs.ts`.
 *
 * Module pur : ni base, ni réseau, ni client Discord. Les valeurs de référence
 * viennent de la base de production (répartition réelle de `profiles.role`,
 * identifiants de `team_members.team_id`), relevées le 13/8/2026.
 */
import { describe, expect, test } from "bun:test";

import {
	CHOIX_JOUR_SEMAINE,
	CHOIX_STATUT_ARTICLE,
	CHOIX_STATUT_CRENEAU,
	COLONNES_PROFIL_AFFICHABLES,
	COLONNES_PROFIL_PRIVEES,
	EQUIPES_RG,
	JOURS_SEMAINE,
	LIMITES_MEMBRE_EQUIPE,
	LIMITE_CUSTOM_ID,
	NOM_EQUIPE_EN_BASE,
	PREFIXE_CONFIRMATION,
	ROLES_ASSIGNABLES,
	ROLES_ATTRIBUABLES,
	ROLES_INTOUCHABLES,
	STATUTS_ARTICLE,
	STATUTS_CRENEAU,
	abregerIdentifiant,
	analyserDate,
	analyserHeure,
	analyserIdConfirmation,
	analyserValeurReglage,
	badgeStatutArticle,
	bornerValeur,
	comparerMembres,
	construireIdConfirmation,
	construirePatchVeille,
	decoderEtatBouton,
	decrireChangement,
	departSuspect,
	encoderEtatBouton,
	estColonneProfilPrivee,
	estConfirme,
	estCreneauPublic,
	estEquipeRg,
	estIdentifiantDiscord,
	estJourSemaine,
	estRoleAssignable,
	estRoleIntouchable,
	estStatutArticle,
	estStatutCreneau,
	estUuid,
	libelleEquipeRg,
	libelleJourSemaine,
	libelleStatutArticle,
	libelleStatutCreneau,
	ligneProfil,
	lireChampTextuel,
	nomAffichable,
	normaliserCleReglage,
	ordreAffichageJour,
	refusValeurReglage,
	urlIllustrationAbsolue,
	validerIdentifiantDiscordFacultatif,
	validerOrdreAffichage,
	validerTexteMembre,
	validerUrlMembre,
	verifierActionSurProfil,
	verifierPlageTemporelle,
} from "./valeurs";

describe("ROLES_ASSIGNABLES", () => {
	test("contient « member », le rôle de 1 839 profils sur 1 850", () => {
		// L'ancien /rg-user ne le proposait pas : filtrer sur le rôle majoritaire
		// de la base était donc impossible.
		expect(ROLES_ASSIGNABLES).toContain("member");
	});

	test("contient aussi « superadmin », présent en base et absent de l'ancienne liste", () => {
		expect(ROLES_ASSIGNABLES).toContain("superadmin");
	});

	test("couvre les rôles observés en production", () => {
		for (const role of ["member", "admin", "superadmin", "user", "moderator"]) {
			expect(estRoleAssignable(role)).toBe(true);
		}
	});

	test("refuse ce qui n'est pas un rôle", () => {
		expect(estRoleAssignable("root")).toBe(false);
		expect(estRoleAssignable("")).toBe(false);
		expect(estRoleAssignable(null)).toBe(false);
		expect(estRoleAssignable(42)).toBe(false);
	});

	test("tient dans les 25 choix d'une option Discord et n'a pas de doublon", () => {
		expect(ROLES_ASSIGNABLES.length).toBeLessThanOrEqual(25);
		expect(new Set(ROLES_ASSIGNABLES).size).toBe(ROLES_ASSIGNABLES.length);
	});
});

describe("statuts d'article", () => {
	test("les trois valeurs de la colonne", () => {
		expect([...STATUTS_ARTICLE]).toEqual(["published", "draft", "archived"]);
	});

	test("refuse une valeur inventée", () => {
		expect(estStatutArticle("publié")).toBe(false);
		expect(estStatutArticle(undefined)).toBe(false);
	});
});

describe("EQUIPES_RG et JOURS_SEMAINE", () => {
	test("les dix équipes portent les identifiants de la base", () => {
		const valeurs = EQUIPES_RG.map((equipe) => equipe.valeur);
		expect(valeurs).toContain("achilleateam");
		expect(valeurs).toContain("assoteam");
		expect(valeurs).toContain("dessinateurteam");
		expect(valeurs).toHaveLength(10);
	});

	test("le jour 0 est dimanche, comme l'index de stream_schedules", () => {
		expect(JOURS_SEMAINE[0]).toBe("Dimanche");
		expect(JOURS_SEMAINE[6]).toBe("Samedi");
	});
});

describe("analyserDate", () => {
	test("accepte les formes ISO ancrées", () => {
		expect(analyserDate("2026-05-01")?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
		expect(analyserDate("2026-05-01T20:00:00Z")?.toISOString()).toBe("2026-05-01T20:00:00.000Z");
		expect(analyserDate("2026-05-01T20:00:00+02:00")?.toISOString()).toBe(
			"2026-05-01T18:00:00.000Z"
		);
	});

	test("accepte l'espace à la place du T", () => {
		expect(analyserDate("2026-05-01 20:00")).not.toBeNull();
	});

	test("refuse les formats ambigus plutôt que de deviner", () => {
		// 01/05/2026 : jour/mois ou mois/jour ? Selon le moteur, ce n'est pas la
		// même date. On refuse.
		expect(analyserDate("01/05/2026")).toBeNull();
		expect(analyserDate("demain")).toBeNull();
		expect(analyserDate("")).toBeNull();
		expect(analyserDate(null)).toBeNull();
	});

	test("refuse une date impossible au lieu de rendre Invalid Date", () => {
		expect(analyserDate("2026-13-45")).toBeNull();
		expect(analyserDate("2026-02-30")).toBeNull();
	});
});

describe("analyserHeure", () => {
	test("normalise sur deux chiffres", () => {
		expect(analyserHeure("9:05")).toBe("09:05");
		expect(analyserHeure("21:30")).toBe("21:30");
	});

	test("refuse hors bornes ou mal formé", () => {
		expect(analyserHeure("24:00")).toBeNull();
		expect(analyserHeure("21:60")).toBeNull();
		expect(analyserHeure("21h30")).toBeNull();
		expect(analyserHeure(undefined)).toBeNull();
	});
});

describe("estUuid et estIdentifiantDiscord", () => {
	test("reconnaît un UUID de profil", () => {
		expect(estUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
		expect(estUuid("3f2504e0-4f89-11d3-9a0c")).toBe(false);
	});

	test("reconnaît un flocon Discord", () => {
		expect(estIdentifiantDiscord("790867082397097984")).toBe(true);
		expect(estIdentifiantDiscord("12345")).toBe(false);
		expect(estIdentifiantDiscord("pas-un-id")).toBe(false);
	});
});

describe("abregerIdentifiant", () => {
	test("coupe à huit caractères", () => {
		expect(abregerIdentifiant("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("3f2504e0…");
	});

	test("laisse passer ce qui est déjà court, et dit l'absence", () => {
		expect(abregerIdentifiant("abc")).toBe("abc");
		expect(abregerIdentifiant(null)).toBe("—");
	});
});

describe("identifiants de bouton de confirmation", () => {
	test("aller-retour complet", () => {
		const id = construireIdConfirmation("oui", "1234567890123456789");
		expect(id).toBe("rgconf|oui|1234567890123456789");
		expect(analyserIdConfirmation(id)).toEqual({
			reponse: "oui",
			graine: "1234567890123456789",
		});
	});

	test("tient sous les 100 caractères imposés par Discord", () => {
		expect(construireIdConfirmation("non", "1234567890123456789").length).toBeLessThanOrEqual(100);
	});

	test("rejette ce qui ne nous appartient pas", () => {
		expect(analyserIdConfirmation("tw|1|2|3")).toBeNull();
		expect(analyserIdConfirmation(`${PREFIXE_CONFIRMATION}|peutetre|123`)).toBeNull();
		expect(analyserIdConfirmation(`${PREFIXE_CONFIRMATION}|oui|`)).toBeNull();
		expect(analyserIdConfirmation(`${PREFIXE_CONFIRMATION}|oui`)).toBeNull();
		expect(analyserIdConfirmation(null)).toBeNull();
	});
});

describe("bornerValeur et decrireChangement", () => {
	test("aplatit une valeur composite sur une ligne", () => {
		expect(bornerValeur({ actif: true, comptes: ["a"] })).toBe('{"actif":true,"comptes":["a"]}');
	});

	test("écrase les sauts de ligne, qui casseraient la ligne d'accusé", () => {
		expect(bornerValeur("une\nvaleur\tmultiligne")).toBe("une valeur multiligne");
	});

	test("distingue absence et chaîne vide", () => {
		expect(bornerValeur(null)).toBe("aucune");
		expect(bornerValeur(undefined)).toBe("aucune");
		expect(bornerValeur("   ")).toBe("vide");
	});

	test("tronque sans dépasser la limite", () => {
		const texte = bornerValeur("w".repeat(400), 50);
		expect(texte.length).toBe(50);
		expect(texte.endsWith("…")).toBe(true);
	});

	test("dit d'où l'on vient, pas seulement où l'on va", () => {
		expect(decrireChangement("member", "admin")).toBe("`member` → `admin`");
		expect(decrireChangement(null, "admin")).toBe("`aucune` → `admin`");
	});

	test("une valeur cyclique ne fait pas lever l'accusé de réception", () => {
		const cyclique: Record<string, unknown> = {};
		cyclique.moi = cyclique;
		expect(() => bornerValeur(cyclique)).not.toThrow();
	});
});

describe("normaliserCleReglage", () => {
	test("accepte les huit clés réellement présentes en base", () => {
		for (const clef of [
			"patreon.cutoff_days",
			"patreon.discord_grace_days",
			"patreon.grandfather_months",
			"patreon.import_addresses_consent",
			"patreon.incentive_max_redemptions",
			"patreon.incentive_offer",
			"patreon.t0",
			"tweets.notification",
		]) {
			expect(normaliserCleReglage(clef)).toBe(clef);
		}
	});

	test("rogne et met en minuscules plutôt que de créer une clé jumelle", () => {
		expect(normaliserCleReglage("  Tweets.Notification ")).toBe("tweets.notification");
	});

	test("refuse ce qui ne peut pas être une clé", () => {
		expect(normaliserCleReglage("tweets notification")).toBeNull();
		expect(normaliserCleReglage(".tweets")).toBeNull();
		expect(normaliserCleReglage("tweets.")).toBeNull();
		expect(normaliserCleReglage("")).toBeNull();
		expect(normaliserCleReglage(42)).toBeNull();
	});
});

describe("analyserValeurReglage", () => {
	test("rend un NOMBRE pour « 60 », comme patreon.cutoff_days en base", () => {
		expect(analyserValeurReglage("60")).toEqual({ valeur: 60, json: true });
	});

	test("rend un booléen pour « true », comme patreon.import_addresses_consent", () => {
		expect(analyserValeurReglage("true")).toEqual({ valeur: true, json: true });
	});

	test("garde une phrase telle quelle, sans exiger de guillemets", () => {
		const lu = analyserValeurReglage("1 mois offert");
		expect(lu.json).toBe(false);
		expect(lu.valeur).toBe("1 mois offert");
	});

	test("lit un objet JSON complet", () => {
		expect(analyserValeurReglage('{"actif":false}')).toEqual({
			valeur: { actif: false },
			json: true,
		});
	});
});

describe("refusValeurReglage", () => {
	test("laisse passer n'importe quelle valeur sur une clé ordinaire", () => {
		expect(refusValeurReglage("patreon.cutoff_days", 60)).toBeNull();
		expect(refusValeurReglage("patreon.import_addresses_consent", true)).toBeNull();
		expect(refusValeurReglage("patreon.incentive_offer", "1 mois offert")).toBeNull();
	});

	test("laisse passer un objet sous tweets.notification", () => {
		expect(
			refusValeurReglage("tweets.notification", {
				actif: false,
				salon: null,
				comptes: ["rose_griffon"],
				max_par_lot: 5,
				categories_exclues: ["fan-content"],
			})
		).toBeNull();
	});

	test("refuse un scalaire sous tweets.notification (le lecteur l'ignorerait en silence)", () => {
		for (const valeur of [false, "off", 0, null]) {
			const refus = refusValeurReglage("tweets.notification", valeur);
			expect(refus).toBeString();
			expect(refus).toContain("/administration veille regler");
		}
	});

	test("refuse aussi un tableau, qu'Array.isArray fait retomber sur les valeurs par défaut", () => {
		expect(refusValeurReglage("tweets.notification", ["rose_griffon"])).toBeString();
	});

	test("la valeur réellement en base au 13/8/2026 reste acceptée", () => {
		const enBase = JSON.parse(
			'{"actif": false, "salon": null, "comptes": ["inazuma_project", "inazuma_cross", "InazumaSeries", "InazumaNational", "Level5Hub", "LEVEL5_times", "Azalee_IE", "rose_griffon"], "max_par_lot": 5, "categories_exclues": ["fan-content"]}'
		) as unknown;
		expect(refusValeurReglage("tweets.notification", enBase)).toBeNull();
	});
});

describe("construirePatchVeille", () => {
	const avant = {
		actif: false,
		comptes: ["inazuma_project", "Level5Hub"],
		categories_exclues: ["fan-content"],
		max_par_lot: 5,
		salon: null,
	};

	test("sans option, aucun champ n'est réécrit", () => {
		const resultat = construirePatchVeille(avant, {});
		expect(resultat.patch).toEqual({});
		expect(resultat.changements).toEqual([]);
	});

	test("régler le seul salon ne réécrit PAS la liste des comptes", () => {
		const resultat = construirePatchVeille(avant, { salon: "123456789012345678" });
		expect(resultat.patch).toEqual({ salon: "123456789012345678" });
		expect(resultat.patch.comptes).toBeUndefined();
		expect(resultat.changements).toHaveLength(1);
	});

	test("un compte déjà suivi, à la casse près, ne change rien", () => {
		expect(construirePatchVeille(avant, { ajouter: "@level5hub" }).patch).toEqual({});
	});

	test("ajoute un compte sans son arobase", () => {
		const resultat = construirePatchVeille(avant, { ajouter: "@Azalee_IE" });
		expect(resultat.patch.comptes).toEqual(["inazuma_project", "Level5Hub", "Azalee_IE"]);
	});

	test("retire un compte quelle que soit la casse saisie", () => {
		const resultat = construirePatchVeille(avant, { retirer: "LEVEL5HUB" });
		expect(resultat.patch.comptes).toEqual(["inazuma_project"]);
	});

	test("retirer un compte absent ne produit aucune écriture", () => {
		expect(construirePatchVeille(avant, { retirer: "inconnu" }).patch).toEqual({});
	});

	test("une valeur identique à l'actuelle n'est pas un changement", () => {
		expect(construirePatchVeille(avant, { actif: false, maxParLot: 5 }).patch).toEqual({});
	});

	test("exclut et réintègre une catégorie", () => {
		expect(construirePatchVeille(avant, { exclure: "leak" }).patch.categories_exclues).toEqual([
			"fan-content",
			"leak",
		]);
		expect(
			construirePatchVeille(avant, { inclure: "Fan-Content" }).patch.categories_exclues
		).toEqual([]);
	});

	test("chaque changement dit d'où l'on vient", () => {
		const resultat = construirePatchVeille(avant, { actif: true });
		expect(resultat.changements[0]).toContain("`coupée` → `active`");
	});
});

describe("comparerMembres", () => {
	const enBase = [
		{ discordId: "1", parti: false },
		{ discordId: "2", parti: false },
		{ discordId: "3", parti: true },
	];

	test("distingue arrivée, mise à jour, retour et départ", () => {
		const resume = comparerMembres(enBase, ["1", "3", "4"]);
		expect(resume.ajoutes).toEqual(["4"]);
		expect(resume.misAJour).toBe(1);
		expect(resume.revenus).toEqual(["3"]);
		expect(resume.partis).toEqual(["2"]);
	});

	test("un serveur inchangé ne produit ni départ ni arrivée", () => {
		const resume = comparerMembres(enBase, ["1", "2"]);
		expect(resume.ajoutes).toEqual([]);
		expect(resume.partis).toEqual([]);
		expect(resume.misAJour).toBe(2);
	});

	test("un membre déjà marqué parti et toujours absent n'est pas recompté", () => {
		expect(comparerMembres(enBase, ["1", "2"]).partis).toEqual([]);
	});

	test("une table vierge ne fabrique aucun départ", () => {
		const resume = comparerMembres([], ["1", "2"]);
		expect(resume.ajoutes).toEqual(["1", "2"]);
		expect(resume.partis).toEqual([]);
	});
});

describe("confidentialité des profils", () => {
	test("l'e-mail et l'adresse postale sont déclarés privés", () => {
		// Les six colonnes réellement présentes dans `profiles` (relevé du
		// 13/8/2026) et qui décrivent une personne hors de nos bases.
		for (const colonne of [
			"email",
			"address_line1",
			"address_line2",
			"city",
			"postal_code",
			"country",
		]) {
			expect(estColonneProfilPrivee(colonne)).toBe(true);
		}
	});

	test("aucune colonne privée n'est affichable", () => {
		const intersection = COLONNES_PROFIL_AFFICHABLES.filter((colonne) =>
			COLONNES_PROFIL_PRIVEES.includes(colonne)
		);
		expect(intersection).toEqual([]);
	});

	test("les identifiants techniques restent affichables", () => {
		expect(COLONNES_PROFIL_AFFICHABLES).toContain("id");
		expect(COLONNES_PROFIL_AFFICHABLES).toContain("discord_id");
		expect(estColonneProfilPrivee("id")).toBe(false);
		expect(estColonneProfilPrivee(null)).toBe(false);
	});

	test("une ligne de liste ne laisse échapper ni e-mail ni adresse", () => {
		// Le profil porte volontairement des champs interdits : la fonction ne
		// les connaît même pas, la ligne ne peut donc pas les contenir.
		const ligne = ligneProfil({
			id: "28dda9f9-6076-4f8d-8e66-a94399d23899",
			username: "yoyo__goat",
			full_name: "Yoyo",
			role: "superadmin",
			discord_id: "281114294152724491",
			...({ email: "secret@exemple.fr", address_line1: "1 rue Interdite" } as object),
		});
		expect(ligne).not.toContain("@exemple.fr");
		expect(ligne).not.toContain("rue Interdite");
		expect(ligne).toContain("28dda9f9-6076-4f8d-8e66-a94399d23899");
		expect(ligne).toContain("<@281114294152724491>");
	});

	test("les tirets bas d'un pseudo Discord sont neutralisés", () => {
		// `yoyo__goat` non échappé passe en souligné : le pseudo affiché n'est
		// alors plus celui de la base.
		expect(ligneProfil({ id: "x", username: "yoyo__goat" })).toContain("yoyo\\_\\_goat");
	});

	test("un profil sans nom retombe sur son identifiant, pas sur son e-mail", () => {
		expect(nomAffichable({ id: "10d04c44-5fa2-5b74-822b-fb487264fa9d" })).toBe("10d04c44…");
		expect(nomAffichable({ id: "x", username: "  ", full_name: null })).toBe("x");
		expect(nomAffichable({ id: "x", username: "zeykyo" })).toBe("zeykyo");
		expect(nomAffichable({ id: "x", username: "zeykyo", full_name: "Zey" })).toBe("Zey");
	});
});

describe("verifierActionSurProfil", () => {
	const acteur = "002c1362-78ed-43d2-8564-6ce10bdb2823";
	const cible = "927694e6-050f-4cca-99f5-99eff1ad186f";

	test("on ne s'administre pas soi-même", () => {
		const verdict = verifierActionSurProfil({
			acteurProfileId: acteur,
			cibleProfileId: acteur,
			roleCible: "admin",
			nouveauRole: "member",
		});
		expect(verdict.autorise).toBe(false);
	});

	test("un superadmin est intouchable", () => {
		// Les deux comptes superadmin de production ne doivent pas pouvoir être
		// rétrogradés depuis un salon Discord.
		const verdict = verifierActionSurProfil({
			acteurProfileId: acteur,
			cibleProfileId: cible,
			roleCible: "superadmin",
			nouveauRole: "member",
		});
		expect(verdict.autorise).toBe(false);
		expect(estRoleIntouchable("superadmin")).toBe(true);
		expect(ROLES_INTOUCHABLES).toContain("superadmin");
	});

	test("superadmin ne s'accorde pas non plus", () => {
		const verdict = verifierActionSurProfil({
			acteurProfileId: acteur,
			cibleProfileId: cible,
			roleCible: "member",
			nouveauRole: "superadmin",
		});
		expect(verdict.autorise).toBe(false);
	});

	test("un rôle inconnu de la base est refusé", () => {
		const verdict = verifierActionSurProfil({
			acteurProfileId: acteur,
			cibleProfileId: cible,
			roleCible: "member",
			nouveauRole: "vip",
		});
		expect(verdict.autorise).toBe(false);
	});

	test("changer un rôle pour le même est refusé", () => {
		const verdict = verifierActionSurProfil({
			acteurProfileId: acteur,
			cibleProfileId: cible,
			roleCible: "member",
			nouveauRole: "member",
		});
		expect(verdict.autorise).toBe(false);
	});

	test("un rôle nul compte comme « user »", () => {
		expect(
			verifierActionSurProfil({
				acteurProfileId: acteur,
				cibleProfileId: cible,
				roleCible: null,
				nouveauRole: "user",
			}).autorise
		).toBe(false);
	});

	test("promouvoir un membre en admin est autorisé", () => {
		expect(
			verifierActionSurProfil({
				acteurProfileId: acteur,
				cibleProfileId: cible,
				roleCible: "member",
				nouveauRole: "admin",
			}).autorise
		).toBe(true);
	});

	test("sans nouveau rôle, seuls les deux premiers interdits s'appliquent", () => {
		expect(
			verifierActionSurProfil({
				acteurProfileId: acteur,
				cibleProfileId: cible,
				roleCible: "member",
			}).autorise
		).toBe(true);
	});
});

describe("équipes", () => {
	test("les dix identifiants d'EQUIPES_RG ont un libellé de base", () => {
		for (const equipe of EQUIPES_RG) {
			expect(estEquipeRg(equipe.valeur)).toBe(true);
			expect(typeof NOM_EQUIPE_EN_BASE[equipe.valeur]).toBe("string");
		}
		expect(Object.keys(NOM_EQUIPE_EN_BASE)).toHaveLength(EQUIPES_RG.length);
	});

	test("assoteam porte le libellé de la base, pas celui de l'ancienne commande", () => {
		// En base : « Membres de l'Association » sur les 24 lignes.
		expect(libelleEquipeRg("assoteam")).toBe("Membres de l'Association");
	});

	test("une équipe inconnue ne se transforme pas en libellé inventé", () => {
		expect(libelleEquipeRg("gryffondorteam")).toBe("gryffondorteam");
		expect(libelleEquipeRg(42)).toBe("équipe inconnue");
		expect(estEquipeRg("gryffondorteam")).toBe(false);
	});
});

describe("validation des champs d'un membre d'équipe", () => {
	test("le nom et le rôle sont obligatoires et bornés", () => {
		expect(validerTexteMembre("nom", "  Kenway ")).toEqual({ ok: true, valeur: "Kenway" });
		expect(validerTexteMembre("nom", "   ").ok).toBe(false);
		expect(validerTexteMembre("role", "r".repeat(LIMITES_MEMBRE_EQUIPE.role + 1)).ok).toBe(false);
	});

	test("une URL vide efface la valeur au lieu d'échouer", () => {
		expect(validerUrlMembre("lien", "")).toEqual({ ok: true, valeur: null });
		expect(validerUrlMembre("lien", undefined)).toEqual({ ok: true, valeur: null });
	});

	test("une URL sans schéma est refusée", () => {
		expect(validerUrlMembre("lien", "x.com/rosegriffon").ok).toBe(false);
		expect(validerUrlMembre("image", "https://cdn.rosegriffon.fr/a.webp")).toEqual({
			ok: true,
			valeur: "https://cdn.rosegriffon.fr/a.webp",
		});
	});

	test("l'ordre d'affichage tient dans un smallint", () => {
		expect(validerOrdreAffichage("12")).toEqual({ ok: true, valeur: 12 });
		expect(validerOrdreAffichage("")).toEqual({ ok: true, valeur: null });
		expect(validerOrdreAffichage("1.5").ok).toBe(false);
		expect(validerOrdreAffichage(-1).ok).toBe(false);
		// 40 000 dépasse le smallint : Postgres refuserait l'INSERT.
		expect(validerOrdreAffichage(40_000).ok).toBe(false);
		expect(validerOrdreAffichage(LIMITES_MEMBRE_EQUIPE.ordreMax).ok).toBe(true);
	});

	test("l'identifiant Discord est un flocon ou rien", () => {
		expect(validerIdentifiantDiscordFacultatif("228659693671677953")).toEqual({
			ok: true,
			valeur: "228659693671677953",
		});
		expect(validerIdentifiantDiscordFacultatif("")).toEqual({ ok: true, valeur: null });
		expect(validerIdentifiantDiscordFacultatif("@kenway").ok).toBe(false);
	});
});

describe("état porté par un bouton", () => {
	test("un aller-retour rend exactement les mêmes valeurs", () => {
		const id = encoderEtatBouton("admusr", { q: "yo", r: "member", o: 20 });
		expect(id).not.toBeNull();
		expect(decoderEtatBouton("admusr", id)).toEqual({ q: "yo", r: "member", o: "20" });
	});

	test("les séparateurs d'une recherche ne cassent pas le découpage", () => {
		const id = encoderEtatBouton("admusr", { q: "a|b=c", o: 0 });
		expect(decoderEtatBouton("admusr", id)?.q).toBe("a|b=c");
	});

	test("les champs vides ne sont pas sérialisés", () => {
		expect(encoderEtatBouton("admusr", { q: "", o: 10 })).toBe("admusr|o=10");
	});

	test("au-delà des 100 caractères de Discord, on rend null plutôt qu'un envoi refusé", () => {
		expect(encoderEtatBouton("admusr", { q: "z".repeat(LIMITE_CUSTOM_ID) })).toBeNull();
	});

	test("un identifiant qui n'est pas à nous n'est pas décodé", () => {
		expect(decoderEtatBouton("admusr", "cpkd|o=1")).toBeNull();
		expect(decoderEtatBouton("admusr", "admusr|cassé")).toBeNull();
		expect(decoderEtatBouton("admusr", "admusr|q=%")).toBeNull();
		expect(decoderEtatBouton("admusr", 12)).toBeNull();
	});
});

describe("urlIllustrationAbsolue", () => {
	test("laisse passer une URL CDN déjà absolue", () => {
		// Valeur réelle de l'article `critique-communautaire-de-inazuma-eleven-victory-road`.
		expect(
			urlIllustrationAbsolue(
				"https://cdn.rosegriffon.fr/dx11/menu/220_img",
				"https://rosegriffon.fr"
			)
		).toBe("https://cdn.rosegriffon.fr/dx11/menu/220_img");
	});

	test("préfixe un chemin relatif, que Discord ne résoudrait pas", () => {
		// Valeur réelle de l'article `mise-a-jour-du-site`.
		expect(urlIllustrationAbsolue("/rgtv/jude.webp", "https://rosegriffon.fr")).toBe(
			"https://rosegriffon.fr/rgtv/jude.webp"
		);
	});

	test("refuse ce qui ferait rejeter l'embed entier", () => {
		expect(urlIllustrationAbsolue("http://exemple.fr/a.png", "https://rosegriffon.fr")).toBeNull();
		expect(urlIllustrationAbsolue("images/a.png", "https://rosegriffon.fr")).toBeNull();
		expect(urlIllustrationAbsolue(null, "https://rosegriffon.fr")).toBeNull();
		expect(urlIllustrationAbsolue("   ", "https://rosegriffon.fr")).toBeNull();
	});
});

describe("departSuspect", () => {
	test("une vague qui dépasse le dixième des présents est suspecte", () => {
		// 1 849 présents relevés le 13/8/2026 : 185 départs d'un coup, non.
		expect(departSuspect(185, 1849)).toBe(true);
		expect(departSuspect(184, 1849)).toBe(false);
	});

	test("un plancher de 20 protège les petits serveurs", () => {
		expect(departSuspect(5, 30)).toBe(false);
		expect(departSuspect(20, 30)).toBe(true);
	});

	test("aucun départ n'est jamais suspect", () => {
		expect(departSuspect(0, 1849)).toBe(false);
	});
});

// ─── Ajouts de `/administration article|evenement|stream` ───────────────────

describe("libellés d'état d'article", () => {
	test("chaque statut de la contrainte SQL a un libellé et une pastille", () => {
		for (const statut of STATUTS_ARTICLE) {
			expect(libelleStatutArticle(statut)).not.toBe("état inconnu");
			expect(badgeStatutArticle(statut)).not.toBe("❔");
		}
	});

	test("les propositions Discord couvrent exactement les statuts de la base", () => {
		// Un choix qui ne serait pas dans `articles_status_check` ferait échouer
		// l'écriture APRÈS que le membre a validé la commande.
		expect(CHOIX_STATUT_ARTICLE.map((choix) => choix.value).toSorted()).toEqual(
			[...STATUTS_ARTICLE].toSorted()
		);
	});

	test("un état inconnu ne fait pas lever et se voit", () => {
		expect(libelleStatutArticle(null)).toBe("état inconnu");
		expect(libelleStatutArticle("publie")).toBe("état inconnu");
		expect(badgeStatutArticle(undefined)).toBe("❔");
	});
});

describe("états d'un créneau de stream", () => {
	test("les trois états sont ceux du formulaire d'administration du site", () => {
		// `apps/website/src/app/admin/stream-schedule/actions.ts` :
		// z.enum(["active", "inactive", "coming_soon"]). Aucune contrainte CHECK
		// ne protège la colonne : cette liste est le seul garde-fou.
		expect([...STATUTS_CRENEAU]).toEqual(["active", "inactive", "coming_soon"]);
		expect(estStatutCreneau("active")).toBe(true);
		expect(estStatutCreneau("actif")).toBe(false);
		expect(estStatutCreneau(null)).toBe(false);
	});

	test("les propositions Discord couvrent exactement ces trois états", () => {
		expect(CHOIX_STATUT_CRENEAU.map((choix) => choix.value).toSorted()).toEqual(
			[...STATUTS_CRENEAU].toSorted()
		);
	});

	test("seul « active » est visible du planning public", () => {
		// Le site et l'API Twitch filtrent tous deux sur status = 'active'.
		expect(estCreneauPublic("active")).toBe(true);
		expect(estCreneauPublic("inactive")).toBe(false);
		expect(estCreneauPublic("coming_soon")).toBe(false);
		expect(estCreneauPublic(null)).toBe(false);
	});

	test("les libellés sont ceux affichés sur le site", () => {
		expect(libelleStatutCreneau("active")).toBe("Actif");
		expect(libelleStatutCreneau("coming_soon")).toBe("À venir");
		expect(libelleStatutCreneau("supprime")).toBe("état inconnu");
	});
});

describe("jours de la semaine", () => {
	test("l'index suit la convention Postgres, 0 = dimanche", () => {
		expect(libelleJourSemaine(0)).toBe("Dimanche");
		expect(libelleJourSemaine(1)).toBe("Lundi");
		expect(libelleJourSemaine(6)).toBe("Samedi");
	});

	test("un index hors des sept jours ne fabrique pas un jour", () => {
		expect(estJourSemaine(7)).toBe(false);
		expect(estJourSemaine(-1)).toBe(false);
		expect(estJourSemaine(1.5)).toBe(false);
		expect(estJourSemaine("1")).toBe(false);
		expect(libelleJourSemaine(9)).toBe("jour inconnu");
	});

	test("la semaine s'affiche du lundi au dimanche, pas l'inverse", () => {
		// Trier sur day_of_week brut mettait dimanche en tête du planning.
		const ordonnes = [0, 1, 2, 3, 4, 5, 6].toSorted(
			(a, b) => ordreAffichageJour(a) - ordreAffichageJour(b)
		);
		expect(ordonnes).toEqual([1, 2, 3, 4, 5, 6, 0]);
	});

	test("les propositions Discord sont déjà dans cet ordre", () => {
		expect(CHOIX_JOUR_SEMAINE.map((choix) => choix.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(CHOIX_JOUR_SEMAINE.map((choix) => choix.name)).toEqual([
			"Lundi",
			"Mardi",
			"Mercredi",
			"Jeudi",
			"Vendredi",
			"Samedi",
			"Dimanche",
		]);
	});

	test("chaque proposition nomme bien le jour de son index", () => {
		for (const choix of CHOIX_JOUR_SEMAINE) {
			expect(libelleJourSemaine(choix.value)).toBe(choix.name);
		}
	});
});

describe("lireChampTextuel", () => {
	test("une option absente laisse la colonne intacte", () => {
		expect(lireChampTextuel(undefined)).toEqual({ fourni: false, valeur: null });
		expect(lireChampTextuel(null)).toEqual({ fourni: false, valeur: null });
		expect(lireChampTextuel("   ")).toEqual({ fourni: false, valeur: null });
	});

	test("un marqueur d'effacement VIDE la colonne — ce que COALESCE interdisait", () => {
		expect(lireChampTextuel("-")).toEqual({ fourni: true, valeur: null });
		expect(lireChampTextuel("Aucun")).toEqual({ fourni: true, valeur: null });
		expect(lireChampTextuel(" VIDE ")).toEqual({ fourni: true, valeur: null });
	});

	test("une vraie valeur est conservée, débarrassée de ses espaces", () => {
		expect(lireChampTextuel("  Palais des congrès  ")).toEqual({
			fourni: true,
			valeur: "Palais des congrès",
		});
	});

	test("« absente » et « à vider » ne se confondent pas", () => {
		// C'est toute la différence entre « ne touche pas au lieu » et
		// « efface le lieu » : l'ancien /rg-event-admin edit les mélangeait.
		expect(lireChampTextuel(undefined).fourni).toBe(false);
		expect(lireChampTextuel("-").fourni).toBe(true);
		expect(lireChampTextuel(undefined).valeur).toBe(lireChampTextuel("-").valeur);
	});
});

describe("verifierPlageTemporelle", () => {
	const debut = new Date("2026-09-01T18:00:00Z");

	test("une plage croissante passe", () => {
		expect(verifierPlageTemporelle(debut, new Date("2026-09-01T21:00:00Z"))).toBeNull();
	});

	test("une fin antérieure au début est refusée", () => {
		const message = verifierPlageTemporelle(debut, new Date("2026-09-01T17:00:00Z"));
		expect(message).toContain("ANTÉRIEURE");
	});

	test("une durée nulle est refusée aussi", () => {
		// `end_time` est NOT NULL mais rien n'empêche l'égalité : l'événement
		// serait alors invisible dès la seconde suivante.
		expect(verifierPlageTemporelle(debut, new Date("2026-09-01T18:00:00Z"))).toContain("zéro");
	});
});

describe("estConfirme", () => {
	test("seul « oui » vaut accord, accents et casse mis à part", () => {
		expect(estConfirme("oui")).toBe(true);
		expect(estConfirme(" OUI ")).toBe(true);
		expect(estConfirme("Oùi")).toBe(true);
	});

	test("tout le reste annule", () => {
		expect(estConfirme("o")).toBe(false);
		expect(estConfirme("yes")).toBe(false);
		expect(estConfirme("non")).toBe(false);
		expect(estConfirme("")).toBe(false);
		expect(estConfirme(undefined)).toBe(false);
		expect(estConfirme(true)).toBe(false);
	});
});

describe("ROLES_ATTRIBUABLES", () => {
	test("n'offre aucun rôle que verifierActionSurProfil refuserait", () => {
		const acteur = "11111111-1111-4111-8111-111111111111";
		const cible = "22222222-2222-4222-8222-222222222222";
		for (const role of ROLES_ATTRIBUABLES) {
			expect(estRoleIntouchable(role)).toBe(false);
			// Le rôle doit être applicable pour de vrai : sur une cible ordinaire qui
			// ne le porte pas encore, le verdict ne peut pas être un refus.
			const verdict = verifierActionSurProfil({
				acteurProfileId: acteur,
				cibleProfileId: cible,
				roleCible: role === "member" ? "user" : "member",
				nouveauRole: role,
			});
			expect(verdict.autorise).toBe(true);
		}
	});

	test("reste un sous-ensemble strict du vocabulaire de lecture", () => {
		for (const role of ROLES_ATTRIBUABLES) {
			expect(ROLES_ASSIGNABLES).toContain(role);
		}
		expect(ROLES_ATTRIBUABLES.length).toBe(ROLES_ASSIGNABLES.length - ROLES_INTOUCHABLES.length);
		// `banned` DOIT y rester : c'est la valeur qu'écrit `/administration
		// utilisateur bannir`. L'en retirer rendrait la commande inopérante.
		expect(ROLES_ATTRIBUABLES).toContain("banned");
		expect(ROLES_ATTRIBUABLES).toContain("member");
		expect(ROLES_ATTRIBUABLES).not.toContain("superadmin");
	});
});
