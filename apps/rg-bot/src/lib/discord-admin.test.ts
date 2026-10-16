/**
 * Tests du socle des pouvoirs Discord.
 *
 * Aucun appel à l'API : tout ce qui est vérifié ici est ce que l'on veut savoir
 * AVANT d'appeler Discord, parce qu'après il est trop tard — un bannissement ne
 * se rejoue pas, et un `50013` ne dit pas ce qui a bloqué.
 */
import { describe, expect, test } from "bun:test";
import {
  AuditLogEvent,
  ChannelType,
  GuildPremiumTier,
  GuildVerificationLevel,
  PermissionFlagsBits,
  PermissionsBitField,
  RESTJSONErrorCodes,
} from "discord.js";

import {
  AGE_MAX_SUPPRESSION_MASSE_MS,
  analyserDuree,
  codeErreurDiscord,
  dureeLisible,
  empechementHierarchie,
  empechementMessagePrive,
  estBannissementInexistant,
  estMembreAbsent,
  exigeRoleAdminRg,
  expliquerCodeDiscord,
  expliquerEmpechement,
  filtrerBannis,
  LIMITE_MESSAGE,
  LIMITE_MOTIF_AUDIT,
  LIMITE_PROPOSITION,
  MAX_EXCLUSION_MS,
  MAX_JOURS_PURGE_BANNISSEMENT,
  MAX_LENTEUR_SECONDES,
  MAX_PROPOSITIONS,
  messageSanctionPrivee,
  motifAudit,
  normaliserJoursPurge,
  normaliserLenteur,
  normaliserNomSalon,
  partitionnerSuppression,
  permissionsManquantes,
  secondesPurgeBannissement,
  // Distribution des rôles (`/administration role`).
  CHOIX_COULEUR_ROLE,
  COULEUR_ROLE_AUCUNE,
  COULEURS_ROLE,
  empechementRole,
  expliquerEmpechementRole,
  LIMITE_NOM,
  MAX_MEMBRES_MASSE,
  normaliserNomRole,
  PAUSE_LOT_MASSE_MS,
  planifierMasse,
  resoudreCouleurRole,
  resumerMasse,
  extraireIdentifiantRole,
  TAILLE_LOT_MASSE,
  trierMembresPourRole,
  // Inspection du serveur (`/staff discord`).
  analyserIdPageInspection,
  assemblerPageInspection,
  BUDGET_DESCRIPTION_INSPECTION,
  MAX_LIGNES_PAGE_INSPECTION,
  raccourcirLigneInspection,
  bornerPageInspection,
  compterHorsDePortee,
  construireIdPageInspection,
  diagnostiquerActions,
  libelleEvenementAudit,
  libelleFonctionnaliteGuilde,
  libelleNiveauBoost,
  libelleNiveauVerification,
  libelleTypeSalon,
  LIBELLES_EVENEMENT_AUDIT,
  manquantesParmi,
  nombreDePagesInspection,
  nomPermissionFr,
  PERMISSIONS_LECTURE_INVITATIONS,
  PERMISSIONS_PAR_ACTION,
  permissionsSensibles,
  pictoTypeSalon,
  trancheInspection,
  // Tenue des salons (`/administration salon`).
  libelleEtatEnvoi,
  LIMITE_SUJET_SALON,
  lireEtatEnvoi,
  lireEtatEnvoiArchive,
  lireTypeSalon,
  nomSalonEffectif,
  PAGES_MAX_PURGE,
  referencesSalon,
  resumerPurge,
  surchargeEnvoi,
  TAILLE_PAGE_MESSAGES,
  TYPES_SALON_CREABLES,
  type BilanPurge,
} from "./discord-admin";

describe("analyserDuree", () => {
  test("lit les formes usuelles", () => {
    expect(analyserDuree("10m")).toBe(600_000);
    expect(analyserDuree("2h")).toBe(7_200_000);
    expect(analyserDuree("7j")).toBe(604_800_000);
    expect(analyserDuree("45 min")).toBe(2_700_000);
    expect(analyserDuree("30s")).toBe(30_000);
  });

  test("additionne les composantes", () => {
    expect(analyserDuree("1h30m")).toBe(5_400_000);
    expect(analyserDuree("1j12h")).toBe(129_600_000);
  });

  test("refuse une saisie partiellement comprise plutôt que d'en deviner la fin", () => {
    // « 10mois » lu comme 10 minutes exclurait quelqu'un 10 minutes au lieu de
    // refuser la saisie : c'est le genre d'écart qui ne se voit jamais.
    expect(analyserDuree("10mois")).toBeNull();
    expect(analyserDuree("bientôt")).toBeNull();
    expect(analyserDuree("10")).toBeNull();
    expect(analyserDuree("")).toBeNull();
    expect(analyserDuree(null)).toBeNull();
  });

  test("refuse au-delà du plafond de 28 jours imposé par l'API", () => {
    expect(analyserDuree("28j")).toBe(MAX_EXCLUSION_MS);
    expect(analyserDuree("29j")).toBeNull();
    expect(analyserDuree("30j")).toBeNull();
  });
});

describe("dureeLisible", () => {
  test("n'écrit pas d'unité vide", () => {
    expect(dureeLisible(5_400_000)).toBe("1 h 30 min");
    expect(dureeLisible(604_800_000)).toBe("7 j");
    expect(dureeLisible(30_000)).toBe("30 s");
  });

  test("rend un tiret sur une durée absurde", () => {
    expect(dureeLisible(0)).toBe("—");
    expect(dureeLisible(Number.NaN)).toBe("—");
  });
});

describe("motifAudit", () => {
  test("nomme toujours l'auteur humain", () => {
    expect(motifAudit({ auteur: "yoyo", motif: "spam répété" })).toBe("spam répété — demandé par yoyo");
    expect(motifAudit({ auteur: "yoyo" })).toBe("Demandé par yoyo");
    expect(motifAudit({ auteur: "yoyo", motif: "   " })).toBe("Demandé par yoyo");
  });

  test("borne à la limite de l'en-tête d'audit", () => {
    const resultat = motifAudit({ auteur: "yoyo", motif: "x".repeat(900) });
    expect(resultat.length).toBe(LIMITE_MOTIF_AUDIT);
    expect(resultat.endsWith("…")).toBe(true);
  });
});

describe("empechementHierarchie", () => {
  const base = {
    positionBot: 10,
    positionCible: 5,
    cibleProprietaire: false,
    cibleEstAuteur: false,
    cibleEstBot: false,
  };

  test("laisse passer une cible sous le bot", () => {
    expect(empechementHierarchie(base)).toBeNull();
  });

  test("refuse un rôle supérieur ou égal", () => {
    expect(empechementHierarchie({ ...base, positionCible: 11 })).toBe("role-superieur");
    expect(empechementHierarchie({ ...base, positionCible: 10 })).toBe("role-egal");
  });

  test("refuse le propriétaire, soi-même et le bot", () => {
    expect(empechementHierarchie({ ...base, cibleProprietaire: true })).toBe("proprietaire");
    expect(empechementHierarchie({ ...base, cibleEstAuteur: true })).toBe("soi-meme");
    expect(empechementHierarchie({ ...base, cibleEstBot: true })).toBe("le-bot");
  });

  test("chaque empêchement a une explication non vide", () => {
    for (const cas of ["soi-meme", "le-bot", "proprietaire", "role-superieur", "role-egal"] as const) {
      expect(expliquerEmpechement(cas).length).toBeGreaterThan(20);
    }
  });
});

describe("permissionsManquantes", () => {
  test("l'administrateur couvre tout", () => {
    const admin = new PermissionsBitField(PermissionFlagsBits.Administrator);
    expect(permissionsManquantes(admin, "bannir")).toEqual([]);
    expect(permissionsManquantes(admin, "purger")).toEqual([]);
    expect(permissionsManquantes(admin, "journal")).toEqual([]);
  });

  test("nomme en clair ce qui manque", () => {
    const lecteur = new PermissionsBitField(PermissionFlagsBits.ViewChannel);
    expect(permissionsManquantes(lecteur, "bannir")).toEqual(["Bannir des membres"]);
    expect(permissionsManquantes(lecteur, "exclure")).toEqual(["Exclure temporairement des membres"]);
  });

  test("ne réclame pas une permission déjà détenue", () => {
    expect(permissionsManquantes(PermissionFlagsBits.BanMembers, "bannir")).toEqual([]);
  });
});

describe("bornes de saisie", () => {
  test("un nom de salon suit la normalisation de Discord", () => {
    expect(normaliserNomSalon("Salon des Annonces")).toBe("salon-des-annonces");
    expect(normaliserNomSalon("  Équipe Azalée  ")).toBe("equipe-azalee");
    expect(normaliserNomSalon("a///b")).toBe("a-b");
    expect(normaliserNomSalon("x".repeat(200)).length).toBe(100);
  });

  test("le mode lent reste dans les six heures", () => {
    expect(normaliserLenteur(0)).toBe(0);
    expect(normaliserLenteur(30)).toBe(30);
    expect(normaliserLenteur(MAX_LENTEUR_SECONDES)).toBe(MAX_LENTEUR_SECONDES);
    expect(normaliserLenteur(MAX_LENTEUR_SECONDES + 1)).toBeNull();
    expect(normaliserLenteur(-1)).toBeNull();
    expect(normaliserLenteur("30")).toBeNull();
  });

  test("la purge de bannissement va de zéro à sept jours", () => {
    expect(normaliserJoursPurge(0)).toBe(0);
    expect(normaliserJoursPurge(7)).toBe(7);
    expect(normaliserJoursPurge(8)).toBeNull();
    expect(normaliserJoursPurge(-1)).toBeNull();
  });
});

describe("partitionnerSuppression", () => {
  const maintenant = 1_776_000_000_000;

  test("écarte les messages de plus de quatorze jours", () => {
    const horodatages = [
      maintenant - 1000,
      maintenant - 60_000,
      maintenant - AGE_MAX_SUPPRESSION_MASSE_MS - 1,
      maintenant - AGE_MAX_SUPPRESSION_MASSE_MS * 2,
    ];
    expect(partitionnerSuppression(horodatages, maintenant, 10)).toEqual({
      supprimables: 2,
      tropAnciens: 2,
      plafonne: false,
    });
  });

  test("signale le plafond de cent", () => {
    const horodatages = Array.from({ length: 150 }, () => maintenant - 1000);
    const resultat = partitionnerSuppression(horodatages, maintenant, 150);
    expect(resultat.supprimables).toBe(100);
    expect(resultat.plafonne).toBe(true);
  });
});

// ─── Modération : ce que l'on veut savoir avant d'appeler l'API ─────────────

describe("expliquerCodeDiscord", () => {
  test("traduit les refus que la modération croise vraiment", () => {
    // Les valeurs numériques viennent de l'énumération de `discord-api-types`,
    // jamais d'un nombre écrit de mémoire : c'est elle qui fait foi.
    expect(expliquerCodeDiscord(RESTJSONErrorCodes.UnknownMember)).toContain("membre du serveur");
    expect(expliquerCodeDiscord(RESTJSONErrorCodes.UnknownBan)).toContain("Aucun bannissement");
    expect(expliquerCodeDiscord(RESTJSONErrorCodes.MissingPermissions)).toContain("hiérarchie");
    expect(expliquerCodeDiscord(RESTJSONErrorCodes.CannotSendMessagesToThisUser)).toContain("messages privés");
    expect(expliquerCodeDiscord(RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds)).toContain(
      "messages privés",
    );
  });

  test("rend null sur un code inconnu plutôt qu'une traduction inventée", () => {
    expect(expliquerCodeDiscord(123_456)).toBeNull();
    expect(expliquerCodeDiscord("50013")).toBeNull();
    expect(expliquerCodeDiscord(undefined)).toBeNull();
  });
});

describe("codeErreurDiscord", () => {
  test("lit le code d'une erreur de l'API sans supposer sa classe", () => {
    expect(codeErreurDiscord({ code: 10_007 })).toBe(10_007);
    // `NotAdminError`, `TypeError`, une panne réseau : rien à traduire.
    expect(codeErreurDiscord(new Error("boom"))).toBeNull();
    // Bun pose parfois un `code` TEXTUEL (`ECONNREFUSED`) : ce n'est pas l'API.
    expect(codeErreurDiscord({ code: "ECONNREFUSED" })).toBeNull();
    expect(codeErreurDiscord(null)).toBeNull();
  });

  test("distingue « pas sur le serveur » de « pas banni »", () => {
    expect(estMembreAbsent({ code: RESTJSONErrorCodes.UnknownMember })).toBe(true);
    expect(estMembreAbsent({ code: RESTJSONErrorCodes.UnknownUser })).toBe(true);
    expect(estMembreAbsent({ code: RESTJSONErrorCodes.UnknownBan })).toBe(false);
    expect(estBannissementInexistant({ code: RESTJSONErrorCodes.UnknownBan })).toBe(true);
    expect(estBannissementInexistant({ code: RESTJSONErrorCodes.UnknownMember })).toBe(false);
  });
});

describe("secondesPurgeBannissement", () => {
  test("convertit les jours en secondes comme l'API les attend", () => {
    expect(secondesPurgeBannissement(0)).toBe(0);
    expect(secondesPurgeBannissement(1)).toBe(86_400);
    expect(secondesPurgeBannissement(MAX_JOURS_PURGE_BANNISSEMENT)).toBe(604_800);
  });

  test("refuse hors bornes plutôt que d'écrêter en silence", () => {
    expect(secondesPurgeBannissement(8)).toBeNull();
    expect(secondesPurgeBannissement(-1)).toBeNull();
    expect(secondesPurgeBannissement("7")).toBeNull();
  });
});

describe("messageSanctionPrivee", () => {
  test("dit la sanction, le serveur et le motif", () => {
    const texte = messageSanctionPrivee({
      sanction: "bannissement",
      serveur: "Rose Griffon",
      motif: "spam répété",
    });
    expect(texte).toContain("banni du serveur Rose Griffon");
    expect(texte).toContain("Motif : spam répété");
  });

  test("n'écrit la durée que pour une exclusion", () => {
    expect(
      messageSanctionPrivee({
        sanction: "exclusion",
        serveur: "Rose Griffon",
        motif: "insultes",
        dureeMs: 5_400_000,
      }),
    ).toContain("Durée : 1 h 30 min");
    expect(
      messageSanctionPrivee({
        sanction: "expulsion",
        serveur: "Rose Griffon",
        dureeMs: 5_400_000,
      }),
    ).not.toContain("Durée");
  });

  test("dit explicitement qu'un avertissement n'est pas une sanction", () => {
    expect(messageSanctionPrivee({ sanction: "avertissement", serveur: "Rose Griffon" })).toContain("Aucune sanction");
  });

  test("ne dépasse jamais la limite d'un message Discord", () => {
    const texte = messageSanctionPrivee({
      sanction: "bannissement",
      serveur: "Rose Griffon",
      motif: "x".repeat(4_000),
    });
    expect(texte.length).toBe(LIMITE_MESSAGE);
  });

  test("assume l'absence de motif au lieu de laisser un blanc", () => {
    expect(messageSanctionPrivee({ sanction: "expulsion", serveur: "Rose Griffon", motif: "   " })).toContain(
      "Aucun motif",
    );
  });
});

describe("empechementMessagePrive", () => {
  test("ne retient que ce qui n'a aucun sens, quelle que soit la hiérarchie", () => {
    expect(empechementMessagePrive({ cibleEstAuteur: true, cibleEstBot: false })).toBe("soi-meme");
    expect(empechementMessagePrive({ cibleEstAuteur: false, cibleEstBot: true })).toBe("le-bot");
    // Un avertissement n'exerce aucun pouvoir Discord : avertir quelqu'un dont
    // le rôle est au-dessus de celui du bot reste parfaitement légitime.
    expect(empechementMessagePrive({ cibleEstAuteur: false, cibleEstBot: false })).toBeNull();
  });
});

describe("filtrerBannis", () => {
  const bannis = [
    { id: "111111111111111111", etiquette: "spammeur", motif: "publicités" },
    { id: "222222222222222222", etiquette: "trolldelabase", motif: null },
    { id: "333333333333333333", etiquette: "compte_jetable" },
  ];

  test("cherche sur le nom ET sur l'identifiant collé", () => {
    expect(filtrerBannis(bannis, "spam").map(p => p.value)).toEqual(["111111111111111111"]);
    expect(filtrerBannis(bannis, "222222222222222222").map(p => p.value)).toEqual(["222222222222222222"]);
    expect(filtrerBannis(bannis, "").length).toBe(3);
  });

  test("renvoie l'identifiant en valeur, jamais le pseudo", () => {
    const [premier] = filtrerBannis(bannis, "spam");
    expect(premier!.value).toBe("111111111111111111");
    expect(premier!.name).toContain("spammeur");
    expect(premier!.name).toContain("publicités");
  });

  test("respecte les deux bornes de Discord", () => {
    const nombreux = Array.from({ length: 60 }, (_, rang) => ({
      id: String(100_000_000_000_000_000 + rang),
      etiquette: "x".repeat(300),
      motif: "y".repeat(300),
    }));
    const propositions = filtrerBannis(nombreux, "");
    expect(propositions.length).toBe(MAX_PROPOSITIONS);
    for (const proposition of propositions) {
      expect(proposition.name.length).toBeLessThanOrEqual(LIMITE_PROPOSITION);
      expect(proposition.value.length).toBeLessThanOrEqual(LIMITE_PROPOSITION);
    }
  });

  test("ne rend rien quand rien ne correspond", () => {
    expect(filtrerBannis(bannis, "introuvable")).toEqual([]);
    expect(filtrerBannis([], "quoi que ce soit")).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INSPECTION — ce qui sert à LIRE l'état du serveur (`/staff discord`)
// ════════════════════════════════════════════════════════════════════════════

describe("nomPermissionFr", () => {
  test("complète la table de modération sans la recopier", () => {
    // Déjà connue de `nomPermission` : la valeur doit venir de LÀ, pas d'un
    // doublon, sinon les deux libellés divergent à la première correction.
    expect(nomPermissionFr(PermissionFlagsBits.BanMembers)).toBe("Bannir des membres");
    // Absente de la table de modération : sans ce complément, l'affichage
    // disait « Permission 32 », ce qui n'aide pas à cliquer au bon endroit.
    expect(nomPermissionFr(PermissionFlagsBits.ManageGuild)).toBe("Gérer le serveur");
    expect(nomPermissionFr(PermissionFlagsBits.ManageWebhooks)).toBe("Gérer les webhooks");
  });

  test("ne rend jamais une chaîne vide, même sur un drapeau inconnu", () => {
    expect(nomPermissionFr(1n << 62n).length).toBeGreaterThan(0);
  });
});

describe("manquantesParmi", () => {
  test("l'administrateur couvre aussi les lectures", () => {
    const admin = new PermissionsBitField(PermissionFlagsBits.Administrator);
    expect(manquantesParmi(admin, PERMISSIONS_LECTURE_INVITATIONS)).toEqual([]);
  });

  test("nomme ce qui manque pour lire les invitations", () => {
    const lecteur = new PermissionsBitField(PermissionFlagsBits.ViewChannel);
    expect(manquantesParmi(lecteur, PERMISSIONS_LECTURE_INVITATIONS)).toEqual(["Gérer le serveur"]);
  });

  test("ne réclame pas une permission déjà détenue", () => {
    expect(manquantesParmi(PermissionFlagsBits.ManageGuild, PERMISSIONS_LECTURE_INVITATIONS)).toEqual([]);
  });
});

describe("permissionsSensibles", () => {
  test("n'applique PAS le raccourci « administrateur couvre tout »", () => {
    // On décrit ce qu'un rôle accorde LITTÉRALEMENT : prétendre qu'un rôle
    // administrateur porte aussi les quatorze autres ferait croire qu'on peut
    // lui en retirer une pour le brider.
    expect(permissionsSensibles(PermissionFlagsBits.Administrator)).toEqual(["Administrateur"]);
  });

  test("liste les seules permissions qui sont une décision", () => {
    const bits =
      PermissionFlagsBits.BanMembers |
      PermissionFlagsBits.ManageRoles |
      // Confort : ne doit PAS ressortir, sinon la ligne qui compte se noie.
      PermissionFlagsBits.AddReactions;
    expect(permissionsSensibles(new PermissionsBitField(bits))).toEqual(["Gérer les rôles", "Bannir des membres"]);
  });

  test("un rôle sans pouvoir ne rend rien", () => {
    expect(permissionsSensibles(PermissionFlagsBits.ViewChannel)).toEqual([]);
  });
});

describe("diagnostiquerActions", () => {
  test("couvre TOUTES les actions déclarées, sans en oublier une", () => {
    const diagnostic = diagnostiquerActions(PermissionFlagsBits.Administrator);
    expect(diagnostic.map(ligne => String(ligne.action)).toSorted()).toEqual(
      Object.keys(PERMISSIONS_PAR_ACTION).toSorted(),
    );
    expect(diagnostic.every(ligne => ligne.possible)).toBe(true);
    expect(diagnostic.every(ligne => ligne.libelle.length > 0)).toBe(true);
  });

  test("dit action par action CE QUI manque", () => {
    const partiel = new PermissionsBitField(PermissionFlagsBits.BanMembers | PermissionFlagsBits.ViewAuditLog);
    const diagnostic = diagnostiquerActions(partiel);
    const parAction = new Map(diagnostic.map(ligne => [ligne.action, ligne]));
    expect(parAction.get("bannir")?.possible).toBe(true);
    expect(parAction.get("journal")?.possible).toBe(true);
    expect(parAction.get("expulser")?.possible).toBe(false);
    expect(parAction.get("expulser")?.manquantes).toEqual(["Expulser des membres"]);
  });
});

describe("compterHorsDePortee", () => {
  test("compte l'égalité de rang comme un refus", () => {
    // Discord exige un rôle STRICTEMENT plus haut : compter en « > » afficherait
    // « 0 membre hors de portée » sur un serveur où le staff partage le rang du bot.
    expect(compterHorsDePortee([1, 5, 10, 11, 20], 10)).toBe(3);
  });

  test("rend zéro quand le bot domine tout le monde", () => {
    expect(compterHorsDePortee([1, 2, 3], 10)).toBe(0);
    expect(compterHorsDePortee([], 10)).toBe(0);
  });
});

describe("traduction des types Discord", () => {
  test("les entrées d'audit sortent en français, jamais en entier brut", () => {
    expect(libelleEvenementAudit(AuditLogEvent.MemberBanAdd)).toBe("Membre banni");
    expect(libelleEvenementAudit(AuditLogEvent.MemberRoleUpdate)).toBe("Rôles d'un membre modifiés");
    // Discord ajoute des types sans prévenir : le repli doit nommer l'entier
    // plutôt que d'afficher un champ vide (un embed à champ vide est REFUSÉ).
    expect(libelleEvenementAudit(9_999)).toBe("Action Discord n° 9999");
  });

  test("chaque libellé d'audit est non vide", () => {
    for (const libelle of Object.values(LIBELLES_EVENEMENT_AUDIT)) {
      expect(libelle.length).toBeGreaterThan(0);
    }
  });

  test("les types de salon et leurs pictogrammes", () => {
    expect(libelleTypeSalon(ChannelType.GuildText)).toBe("Textuel");
    expect(libelleTypeSalon(ChannelType.GuildCategory)).toBe("Catégorie");
    expect(libelleTypeSalon(ChannelType.GuildForum)).toBe("Forum");
    expect(libelleTypeSalon(123)).toBe("Type n° 123");
    expect(pictoTypeSalon(ChannelType.GuildVoice)).toBe("🔊");
    expect(pictoTypeSalon(123)).toBe("•");
  });

  test("boost et vérification", () => {
    expect(libelleNiveauBoost(GuildPremiumTier.None)).toBe("Aucun palier");
    expect(libelleNiveauBoost(GuildPremiumTier.Tier3)).toBe("Palier 3");
    expect(libelleNiveauBoost(42)).toBe("Palier n° 42");
    expect(libelleNiveauVerification(GuildVerificationLevel.None)).toBe("Aucune");
    expect(libelleNiveauVerification(GuildVerificationLevel.VeryHigh)).toContain("Très élevée");
    expect(libelleNiveauVerification(42)).toBe("Niveau n° 42");
  });

  test("les fonctionnalités de serveur cessent d'être des majuscules illisibles", () => {
    expect(libelleFonctionnaliteGuilde("COMMUNITY")).toBe("Serveur communautaire");
    expect(libelleFonctionnaliteGuilde("ANIMATED_ICON")).toBe("Icône animée");
    // Repli sur une fonctionnalité que Discord vient d'ajouter.
    expect(libelleFonctionnaliteGuilde("NEW_SHINY_THING")).toBe("New shiny thing");
    expect(libelleFonctionnaliteGuilde("")).toBe("");
  });
});

describe("pagination de l'inspection", () => {
  test("une liste vide reste une page", () => {
    expect(nombreDePagesInspection(0)).toBe(1);
    expect(nombreDePagesInspection(25)).toBe(1);
    expect(nombreDePagesInspection(26)).toBe(2);
    expect(nombreDePagesInspection(51)).toBe(3);
  });

  test("une page hors bornes est ramenée dedans, jamais rendue vide", () => {
    expect(bornerPageInspection(0, 100)).toBe(1);
    expect(bornerPageInspection(-3, 100)).toBe(1);
    expect(bornerPageInspection(99, 100)).toBe(4);
    expect(bornerPageInspection(Number.NaN, 100)).toBe(1);
  });

  test("la tranche suit la page bornée", () => {
    const elements = Array.from({ length: 60 }, (_, rang) => rang);
    expect(trancheInspection(elements, 1)).toHaveLength(25);
    expect(trancheInspection(elements, 3)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    // Page au-delà de la dernière : on rend la dernière, pas un tableau vide.
    expect(trancheInspection(elements, 99)[0]).toBe(50);
    expect(trancheInspection([], 1)).toEqual([]);
  });

  test("l'état d'un bouton fait l'aller-retour", () => {
    const etat = { vue: "bannissements", page: 3, graine: "123456789012345678" };
    const id = construireIdPageInspection(etat);
    expect(id).toBe("rgdisc|bannissements|3|123456789012345678");
    expect(analyserIdPageInspection(id)).toEqual(etat);
  });

  test("refuse ce qui n'est pas à nous, ou ce qui est illisible", () => {
    expect(analyserIdPageInspection("tw|page=2")).toBeNull();
    expect(analyserIdPageInspection("rgdisc|bannissements|3")).toBeNull();
    expect(analyserIdPageInspection("rgdisc|bannissements|zero|42")).toBeNull();
    expect(analyserIdPageInspection("rgdisc|bannissements|0|42")).toBeNull();
    expect(analyserIdPageInspection(null)).toBeNull();
  });

  test("rend null plutôt que de faire refuser le message entier", () => {
    // 100 caractères est la borne DURE d'un `custom_id` : au-delà, c'est le
    // message COMPLET que Discord rejette, pas seulement le bouton.
    expect(construireIdPageInspection({ vue: "x".repeat(120), page: 1, graine: "42" })).toBeNull();
    // Un séparateur dans une valeur casserait le découpage à la relecture.
    expect(construireIdPageInspection({ vue: "a|b", page: 1, graine: "42" })).toBeNull();
  });
});

// ─── `/administration role` ─────────────────────────────────────────────────

describe("palette des rôles", () => {
  test("chaque entier est bien la lecture de son hexadécimal", () => {
    // Un décalage ici donnerait un rôle d'une couleur qui n'existe nulle part
    // dans la charte, et personne ne le rapprocherait jamais de ce fichier.
    for (const couleur of COULEURS_ROLE) {
      if (couleur.valeur === COULEUR_ROLE_AUCUNE) {
        expect(couleur.entier).toBe(0);
        expect(couleur.hex).toBe("");
        continue;
      }
      expect(couleur.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(couleur.entier).toBe(Number.parseInt(couleur.hex.slice(1), 16));
    }
  });

  test("la palette tient dans une liste de choix Discord", () => {
    // 25 choix au maximum, 100 caractères par libellé : au-delà, l'API refuse
    // l'ENREGISTREMENT de la commande, donc la commande entière disparaît.
    expect(CHOIX_COULEUR_ROLE.length).toBeLessThanOrEqual(25);
    expect(CHOIX_COULEUR_ROLE.length).toBe(COULEURS_ROLE.length);
    for (const choix of CHOIX_COULEUR_ROLE) {
      expect(choix.name.length).toBeLessThanOrEqual(100);
      expect(choix.value.length).toBeGreaterThan(0);
    }
    const valeurs = new Set(CHOIX_COULEUR_ROLE.map(choix => choix.value));
    expect(valeurs.size).toBe(CHOIX_COULEUR_ROLE.length);
  });

  test("une option absente vaut « aucune couleur », une valeur inventée vaut refus", () => {
    expect(resoudreCouleurRole(undefined)?.valeur).toBe(COULEUR_ROLE_AUCUNE);
    expect(resoudreCouleurRole(null)?.valeur).toBe(COULEUR_ROLE_AUCUNE);
    expect(resoudreCouleurRole("GRIFFON")?.valeur).toBe("griffon");
    expect(resoudreCouleurRole("  rose  ")?.valeur).toBe("rose");
    expect(resoudreCouleurRole("#ff00ff")).toBeNull();
    expect(resoudreCouleurRole("fuchsia")).toBeNull();
    expect(resoudreCouleurRole(42)).toBeNull();
  });
});

describe("normaliserNomRole", () => {
  test("garde majuscules et accents, mais compacte les espaces", () => {
    // Discord ne retouche PAS un nom de rôle, contrairement à un nom de salon :
    // « Équipe Azalée » doit ressortir tel quel, pas en « equipe-azalee ».
    expect(normaliserNomRole("  Équipe Azalée  ")).toBe("Équipe Azalée");
    expect(normaliserNomRole("Staff\n\nRose   Griffon")).toBe("Staff Rose Griffon");
  });

  test("refuse le vide, le trop long et les deux mentions générales", () => {
    expect(normaliserNomRole("   ")).toBeNull();
    expect(normaliserNomRole("")).toBeNull();
    expect(normaliserNomRole("x".repeat(LIMITE_NOM))).toHaveLength(LIMITE_NOM);
    expect(normaliserNomRole("x".repeat(LIMITE_NOM + 1))).toBeNull();
    expect(normaliserNomRole("@everyone")).toBeNull();
    expect(normaliserNomRole("@HERE")).toBeNull();
    expect(normaliserNomRole(null)).toBeNull();
    expect(normaliserNomRole(12)).toBeNull();
  });
});

describe("empechementRole", () => {
  const base = {
    estEveryone: false,
    gereParIntegration: false,
    estRoleDuBot: false,
    porteAdministration: false,
    positionRole: 5,
    positionBot: 10,
  };

  test("laisse passer un rôle ordinaire situé sous le bot", () => {
    expect(empechementRole(base)).toBeNull();
  });

  test("la hiérarchie se joue sur le rang du RÔLE, pas sur celui du membre", () => {
    expect(empechementRole({ ...base, positionRole: 11 })).toBe("role-superieur");
    expect(empechementRole({ ...base, positionRole: 10 })).toBe("role-egal");
    expect(empechementRole({ ...base, positionRole: 9 })).toBeNull();
  });

  test("écarte @everyone, les rôles d'intégration, celui du bot et l'administration", () => {
    expect(empechementRole({ ...base, estEveryone: true })).toBe("everyone");
    expect(empechementRole({ ...base, gereParIntegration: true })).toBe("gere-par-integration");
    expect(empechementRole({ ...base, estRoleDuBot: true })).toBe("role-du-bot");
    expect(empechementRole({ ...base, porteAdministration: true })).toBe("administration");
  });

  test("le rôle du bot se dit AVANT « géré par une intégration »", () => {
    // Le rôle d'un bot est presque toujours `managed` : sans cet ordre, le
    // refus le plus fréquent s'expliquerait par la cause la moins parlante.
    expect(empechementRole({ ...base, estRoleDuBot: true, gereParIntegration: true })).toBe("role-du-bot");
  });

  test("chaque empêchement a une explication qui dit quoi faire", () => {
    for (const cas of [
      "everyone",
      "gere-par-integration",
      "role-du-bot",
      "administration",
      "role-superieur",
      "role-egal",
    ] as const) {
      expect(expliquerEmpechementRole(cas).length).toBeGreaterThan(40);
    }
  });
});

describe("planifierMasse", () => {
  test("découpe en lots et annonce un plancher de durée honnête", () => {
    const plan = planifierMasse(12);
    expect(plan.aTraiter).toBe(12);
    expect(plan.lots).toBe(Math.ceil(12 / TAILLE_LOT_MASSE));
    expect(plan.pauseMs).toBe(PAUSE_LOT_MASSE_MS);
    // Trois lots, donc DEUX pauses : la dernière ne sert à rien.
    expect(plan.dureeMinimaleMs).toBe((plan.lots - 1) * PAUSE_LOT_MASSE_MS);
    expect(plan.plafonne).toBe(false);
    expect(plan.ignores).toBe(0);
  });

  test("plafonne à cinq cents et dit combien restent", () => {
    const plan = planifierMasse(MAX_MEMBRES_MASSE + 100);
    expect(plan.aTraiter).toBe(MAX_MEMBRES_MASSE);
    expect(plan.ignores).toBe(100);
    expect(plan.plafonne).toBe(true);
  });

  test("un ensemble vide ne planifie ni lot ni pause", () => {
    expect(planifierMasse(0)).toMatchObject({ lots: 0, dureeMinimaleMs: 0, aTraiter: 0 });
    expect(planifierMasse(-5).aTraiter).toBe(0);
    expect(planifierMasse(Number.NaN).aTraiter).toBe(0);
  });
});

describe("trierMembresPourRole", () => {
  const membres = [
    { id: "1", roles: ["r1", "r2"] },
    { id: "2", roles: ["r2"] },
    { id: "3", roles: [] as string[] },
  ];

  test("n'appelle pas l'API pour un membre déjà pourvu", () => {
    expect(trierMembresPourRole(membres, "r1", "donner")).toEqual({
      aTraiter: ["2", "3"],
      sansChangement: ["1"],
    });
  });

  test("le retrait est l'exact miroir de l'attribution", () => {
    expect(trierMembresPourRole(membres, "r1", "retirer")).toEqual({
      aTraiter: ["1"],
      sansChangement: ["2", "3"],
    });
  });
});

describe("resumerMasse", () => {
  test("écrit les quatre nombres, même à zéro", () => {
    const resume = resumerMasse({
      reussis: 3,
      echecs: 0,
      sansChangement: 2,
      ignores: 0,
      dureeMs: 4_000,
    });
    expect(resume).toContain("Attribué : **3**");
    expect(resume).toContain("Échecs : **0**");
    expect(resume).toContain("Déjà pourvus (aucun appel) : **2**");
    expect(resume).toContain("4 s");
    expect(resume).not.toContain("plafond");
  });

  test("réclame une relance quand le plafond a mordu", () => {
    const resume = resumerMasse({
      reussis: MAX_MEMBRES_MASSE,
      echecs: 0,
      sansChangement: 0,
      ignores: 7,
      dureeMs: 150_000,
    });
    expect(resume).toContain("**7**");
    expect(resume).toContain("plafond");
  });
});

describe("exigeRoleAdminRg", () => {
  test("un rôle purement décoratif se distribue sans rang particulier", () => {
    // Le cas courant : un rôle de couleur, une mention d'équipe. Exiger `admin`
    // pour ça rendrait la commande inutilisable au quotidien et pousserait à
    // distribuer les rôles à la main, hors de toute trace.
    expect(exigeRoleAdminRg(PermissionFlagsBits.ViewChannel)).toBe(false);
    expect(exigeRoleAdminRg(new PermissionsBitField(0n))).toBe(false);
  });

  test("un rôle qui bannit exige le même rang que la commande qui bannit", () => {
    // C'est le contournement que la règle ferme : un `staff` se donne ce rôle,
    // puis bannit depuis l'interface de Discord sans jamais affronter la garde
    // stricte de `/administration moderation bannir`.
    expect(exigeRoleAdminRg(PermissionFlagsBits.BanMembers)).toBe(true);
  });

  test("les pouvoirs qui ne sont pas « Administrateur » comptent aussi", () => {
    // `empechementRole` n'écarte que le drapeau « Administrateur ». Aucun des
    // autres pouvoirs n'en a besoin pour faire des dégâts sur ~1 984 membres.
    expect(exigeRoleAdminRg(PermissionFlagsBits.ManageRoles)).toBe(true);
    expect(exigeRoleAdminRg(PermissionFlagsBits.ManageGuild)).toBe(true);
    expect(exigeRoleAdminRg(PermissionFlagsBits.ManageWebhooks)).toBe(true);
    expect(exigeRoleAdminRg(new PermissionsBitField(PermissionFlagsBits.AddReactions))).toBe(false);
  });
});

describe("extraireIdentifiantRole", () => {
  test("accepte un flocon nu comme une mention collée", () => {
    expect(extraireIdentifiantRole("123456789012345678")).toBe("123456789012345678");
    expect(extraireIdentifiantRole("  <@&123456789012345678>  ")).toBe("123456789012345678");
  });

  test("refuse un nom de rôle plutôt que d'agir sur un homonyme", () => {
    // Deux rôles peuvent porter le même nom : « celui trouvé en premier » n'est
    // pas une cible acceptable quand la commande supprime.
    expect(extraireIdentifiantRole("Staff")).toBeNull();
    expect(extraireIdentifiantRole("<@123456789012345678>")).toBeNull();
    expect(extraireIdentifiantRole("12345")).toBeNull();
    expect(extraireIdentifiantRole(null)).toBeNull();
    expect(extraireIdentifiantRole(123)).toBeNull();
  });
});

// ── Tenue des salons (`/administration salon`) ───────────────────────────────

describe("types de salon créables", () => {
  test("les trois valeurs proposées se résolvent, le reste non", () => {
    expect(lireTypeSalon("textuel")?.type).toBe(ChannelType.GuildText);
    expect(lireTypeSalon("vocal")?.type).toBe(ChannelType.GuildVoice);
    expect(lireTypeSalon("annonce")?.type).toBe(ChannelType.GuildAnnouncement);
    expect(lireTypeSalon(" Vocal ")?.valeur).toBe("vocal");
    expect(lireTypeSalon("forum")).toBeNull();
    expect(lireTypeSalon(null)).toBeNull();
    expect(lireTypeSalon(ChannelType.GuildText)).toBeNull();
  });

  test("seul le salon d'annonces exige une Communauté", () => {
    const exigeants = TYPES_SALON_CREABLES.filter(type => type.exigeCommunaute);
    expect(exigeants.map(type => type.valeur)).toEqual(["annonce"]);
  });

  test("le vocal est le seul dont Discord ne réécrit pas le nom", () => {
    const preserves = TYPES_SALON_CREABLES.filter(type => !type.nomNormalise);
    expect(preserves.map(type => type.valeur)).toEqual(["vocal"]);
  });
});

describe("nomSalonEffectif", () => {
  const textuel = lireTypeSalon("textuel")!;
  const vocal = lireTypeSalon("vocal")!;

  test("annonce le nom que Discord va réellement poser", () => {
    // Le salon créé s'appellera « salon-des-annonces » : afficher la saisie
    // ferait croire à un bug de nommage à la première relecture.
    expect(nomSalonEffectif("Salon des Annonces", textuel)).toBe("salon-des-annonces");
    expect(nomSalonEffectif("  Équipe Azalée  ", textuel)).toBe("equipe-azalee");
  });

  test("laisse un salon vocal garder ses majuscules et ses espaces", () => {
    expect(nomSalonEffectif("  Salon Vocal Test  ", vocal)).toBe("Salon Vocal Test");
    expect(nomSalonEffectif("é".repeat(150), vocal)!.length).toBe(100);
  });

  test("refuse une saisie qui ne laisse rien après normalisation", () => {
    expect(nomSalonEffectif("???", textuel)).toBeNull();
    expect(nomSalonEffectif("   ", vocal)).toBeNull();
    expect(nomSalonEffectif(null, textuel)).toBeNull();
  });
});

describe("état d'envoi d'un salon", () => {
  test("distingue les trois états, pas deux", () => {
    expect(lireEtatEnvoi(null)).toBe("herite");
    expect(lireEtatEnvoi({ autorise: false, refuse: false })).toBe("herite");
    expect(lireEtatEnvoi({ autorise: true, refuse: false })).toBe("autorise");
    expect(lireEtatEnvoi({ autorise: false, refuse: true })).toBe("refuse");
  });

  test("un refus l'emporte sur une autorisation contradictoire", () => {
    expect(lireEtatEnvoi({ autorise: true, refuse: true })).toBe("refuse");
  });

  test("l'héritage se rétablit par `null`, pas par « autorisé »", () => {
    // Remettre `true` là où il n'y avait rien OUVRIRAIT un salon que la
    // catégorie tenait fermé : `deverrouiller` doit rendre exactement l'état
    // d'avant, et cette valeur est celle que l'API attend pour retirer le bit.
    expect(surchargeEnvoi("herite")).toBeNull();
    expect(surchargeEnvoi("autorise")).toBe(true);
    expect(surchargeEnvoi("refuse")).toBe(false);
  });

  test("chaque état a un libellé lisible", () => {
    for (const etat of ["autorise", "refuse", "herite"] as const) {
      expect(libelleEtatEnvoi(etat).length).toBeGreaterThan(5);
    }
  });

  test("relit l'état archivé dans la trace d'audit, et rien d'autre", () => {
    expect(lireEtatEnvoiArchive({ envoyer_avant: "herite" })).toBe("herite");
    expect(lireEtatEnvoiArchive({ envoyer_avant: "autorise", motif: "spam" })).toBe("autorise");
    expect(lireEtatEnvoiArchive({ envoyer_avant: "peut-être" })).toBeNull();
    expect(lireEtatEnvoiArchive({})).toBeNull();
    expect(lireEtatEnvoiArchive(null)).toBeNull();
    expect(lireEtatEnvoiArchive("herite")).toBeNull();
  });
});

describe("resumerPurge", () => {
  const base: BilanPurge = {
    demande: 100,
    examines: 100,
    epingles: 0,
    supprimables: 100,
    tropAnciens: 0,
    plafonne: false,
    tronque: false,
  };

  test("donne le chiffre réel et l'écart avec la demande", () => {
    const resume = resumerPurge({ ...base, supprimables: 37, tropAnciens: 63 });
    expect(resume).toContain("**37** messages sur les 100 demandés");
    expect(resume).toContain("63 ont plus de quatorze jours");
  });

  test("n'invente pas d'écart quand il n'y en a pas", () => {
    const resume = resumerPurge(base);
    expect(resume).toContain("**100** messages sur les 100 demandés");
    expect(resume).not.toContain("quatorze jours");
    expect(resume).not.toContain("épinglé");
  });

  test("nomme les épingles laissées en place, au singulier comme au pluriel", () => {
    expect(resumerPurge({ ...base, supprimables: 99, epingles: 1 })).toContain(
      "1 message épinglé a été laissé en place",
    );
    expect(resumerPurge({ ...base, supprimables: 96, epingles: 4 })).toContain(
      "4 messages épinglés ont été laissés en place",
    );
  });

  test("avoue une recherche tronquée plutôt que de laisser croire à un salon vide", () => {
    const resume = resumerPurge({
      ...base,
      examines: PAGES_MAX_PURGE * TAILLE_PAGE_MESSAGES,
      tronque: true,
    });
    expect(resume).toContain(`${PAGES_MAX_PURGE} pages`);
    expect(resume).toContain("500 messages parcourus");
  });
});

describe("referencesSalon", () => {
  test("nomme chaque endroit où l'identifiant est câblé", () => {
    const sources = {
      DISCORD_NEWS_CHANNEL_ID: "111",
      "DISCORD_CHANNELS.ANNONCES": "111",
      "settings['tweets.notification'].salon": "222",
      DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID: undefined,
    };
    expect(referencesSalon("111", sources)).toEqual(["DISCORD_NEWS_CHANNEL_ID", "DISCORD_CHANNELS.ANNONCES"]);
    expect(referencesSalon("222", sources)).toEqual(["settings['tweets.notification'].salon"]);
    expect(referencesSalon("333", sources)).toEqual([]);
  });

  test("ne confond pas une valeur absente avec une correspondance", () => {
    expect(referencesSalon("", { A: "" })).toEqual([]);
    expect(referencesSalon("111", { A: null, B: undefined })).toEqual([]);
  });
});

describe("bornes des salons", () => {
  test("le sujet suit la limite du type réellement créé", () => {
    expect(LIMITE_SUJET_SALON).toBe(1_024);
  });

  test("une page de messages ne dépasse pas le plafond de l'API", () => {
    expect(TAILLE_PAGE_MESSAGES).toBe(100);
  });
});

// ── Une page d'inspection ne perd jamais d'entrée (`/staff discord`) ─────────
describe("assemblerPageInspection", () => {
  test("laisse les lignes intactes tant qu'elles tiennent", () => {
    const lignes = ["alpha", "bêta", "gamma"];
    expect(assemblerPageInspection(lignes)).toBe("alpha\nbêta\ngamma");
  });

  test("garde les 25 entrées d'une page plutôt que d'en faire disparaître la fin", () => {
    // C'est le cœur du problème : 25 bannissements avec un motif de 200
    // caractères font 7 000 caractères, la description d'un embed est plafonnée
    // à 4 096, et la page suivante reprend à l'indice 26 — les entrées coupées
    // ne seraient JAMAIS affichables.
    const lignes = Array.from(
      { length: MAX_LIGNES_PAGE_INSPECTION },
      (_, rang) => `entrée ${rang + 1} ${"x".repeat(300)}`,
    );
    const assemble = assemblerPageInspection(lignes);
    expect(assemble.length).toBeLessThanOrEqual(4_096);
    for (let rang = 1; rang <= MAX_LIGNES_PAGE_INSPECTION; rang += 1) {
      expect(assemble).toContain(`entrée ${rang} `);
    }
    expect(assemble.split("\n")).toHaveLength(MAX_LIGNES_PAGE_INSPECTION);
  });

  test("ne dépasse jamais le budget de plus de deux caractères par ligne refermée", () => {
    const lignes = Array.from({ length: 25 }, () => `**${"y".repeat(400)}`);
    const assemble = assemblerPageInspection(lignes);
    expect(assemble.length).toBeLessThanOrEqual(BUDGET_DESCRIPTION_INSPECTION + 2 * 25);
    expect(assemble.length).toBeLessThanOrEqual(4_096);
  });

  test("rend une chaîne vide sur une liste vide, jamais un séparateur seul", () => {
    expect(assemblerPageInspection([])).toBe("");
  });
});

describe("raccourcirLigneInspection", () => {
  test("ne touche pas une ligne qui tient", () => {
    expect(raccourcirLigneInspection("court", 20)).toBe("court");
  });

  test("referme un gras coupé au milieu, sinon toute la liste part en gras", () => {
    const coupe = raccourcirLigneInspection(`**${"a".repeat(50)}** — reste`, 20);
    expect(coupe.endsWith("**")).toBe(true);
    expect((coupe.match(/\*\*/g) ?? []).length % 2).toBe(0);
  });

  test("ne referme rien quand la coupe tombe sur un gras déjà équilibré", () => {
    const coupe = raccourcirLigneInspection(`**ok** ${"b".repeat(80)}`, 30);
    expect((coupe.match(/\*\*/g) ?? []).length).toBe(2);
    expect(coupe).toContain("…");
  });

  test("reste défini même sur une limite absurde", () => {
    expect(raccourcirLigneInspection("peu importe", 1)).toBe("…");
    expect(raccourcirLigneInspection("peu importe", 0)).toBe("…");
  });
});
