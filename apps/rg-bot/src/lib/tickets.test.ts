/**
 * Tests du noyau de tickets.
 *
 * Deux règles y sont vérifiées de près, parce que ce sont celles qui ont un
 * coût réel quand elles cassent :
 *
 *  1. la CONTINUITÉ des numéros — deux tickets « #12 » dans le même salon
 *     d'historique rendraient ambiguë la seule référence que le staff cite ;
 *  2. l'accès aux tickets SENSIBLES — un signalement qui vise un modérateur ne
 *     doit jamais arriver dans les mains de la modération ordinaire.
 */
import { describe, expect, test } from "bun:test";

import {
  CATEGORIES_TICKET,
  categorieTicket,
  estEtatTicket,
  fuitesDAcces,
  identifiantComposant,
  invitations,
  libelleCategorieTicket,
  libelleEtatTicket,
  LONGUEUR_MOTIF,
  LONGUEUR_NOM_SALON,
  LONGUEUR_SUJET,
  lireComposant,
  manqueDeConfiguration,
  motifPropre,
  nomSalonTicket,
  NUMERO_DEPART,
  prochainNumero,
  referenceTicket,
  refusTransition,
  sujetPropre,
  transitionPermise,
  verifierOuverture,
} from "./tickets";
import { LIMITES } from "./ui/theme";

describe("continuité des numéros", () => {
  test("on reprend là où ticketsbot s'est arrêté", () => {
    // 85 est le plus grand identifiant des 84 cartes de `📦〡ticket-history`
    // (relevé le 14/8/2026). Repartir de 1 créerait des doublons de référence.
    expect(NUMERO_DEPART).toBe(86);
    expect(prochainNumero(null)).toBe(86);
    expect(prochainNumero(0)).toBe(86);
  });

  test("une fois lancé, c'est la base qui commande", () => {
    expect(prochainNumero(86)).toBe(87);
    expect(prochainNumero(240)).toBe(241);
  });

  test("un dernier numéro aberrant ne fait pas régresser la suite", () => {
    expect(prochainNumero(Number.NaN)).toBe(86);
    expect(prochainNumero(-40)).toBe(86);
  });
});

describe("nommage", () => {
  test("le nom du fil ne porte QUE le numéro, jamais le pseudo", () => {
    expect(nomSalonTicket(86)).toBe("ticket-0086");
    expect(nomSalonTicket(1_234)).toBe("ticket-1234");
  });

  test("le rembourrage fait coïncider ordre alphabétique et chronologie", () => {
    const noms = [9, 10, 100].map(nomSalonTicket);
    expect(noms.toSorted()).toEqual(noms);
  });

  test("le nom tient toujours dans la limite de l'API", () => {
    expect(nomSalonTicket(999_999).length).toBeLessThanOrEqual(LONGUEUR_NOM_SALON);
  });

  test("la référence se cite telle quelle", () => {
    expect(referenceTicket(86)).toBe("#0086");
  });
});

describe("sujet et motif", () => {
  test("les retours à la ligne sont écrasés", () => {
    expect(sujetPropre("Un souci\navec   la boutique")).toBe("Un souci avec la boutique");
  });

  test("un sujet vide n'existe pas", () => {
    expect(sujetPropre("   ")).toBeNull();
    expect(sujetPropre(null)).toBeNull();
    expect(sujetPropre(42)).toBeNull();
  });

  test("un sujet trop long est abrégé, jamais refusé", () => {
    const long = sujetPropre("a".repeat(LONGUEUR_SUJET + 50));
    expect(long).not.toBeNull();
    expect((long as string).length).toBe(LONGUEUR_SUJET);
    expect(long as string).toEndWith("…");
  });

  test("le motif accepte une vraie synthèse", () => {
    const motif = motifPropre("b".repeat(LONGUEUR_MOTIF + 10));
    expect((motif as string).length).toBe(LONGUEUR_MOTIF);
    expect(LONGUEUR_MOTIF).toBeGreaterThan(LONGUEUR_SUJET);
  });

  test("un motif vide est refusé — c'est la consigne du staff", () => {
    expect(motifPropre("")).toBeNull();
    expect(motifPropre("  \n ")).toBeNull();
  });
});

describe("états", () => {
  test("les trois états ont un libellé à pastille", () => {
    for (const etat of ["ouvert", "pris", "ferme"]) {
      expect(estEtatTicket(etat)).toBe(true);
      expect(libelleEtatTicket(etat)).toMatch(/^[🟢🟡⚫]/u);
    }
    expect(libelleEtatTicket("zzz")).toBe("⚪ État inconnu");
  });

  test("un ticket pris peut être rendu", () => {
    expect(transitionPermise("pris", "ouvert")).toBe(true);
  });

  test("un ticket fermé ne se rouvre pas, et l'erreur dit ce qui reste possible", () => {
    expect(transitionPermise("ferme", "ouvert")).toBe(false);
    expect(refusTransition("ferme", "ouvert")).toContain("fil reste lisible");
  });

  test("les transitions inconnues sont refusées, pas devinées", () => {
    expect(transitionPermise("ouvert", "archive")).toBe(false);
    expect(transitionPermise("", "")).toBe(false);
  });
});

describe("ouverture", () => {
  test("cinq catégories au plus : c'est une rangée de boutons", () => {
    expect(CATEGORIES_TICKET.length).toBeLessThanOrEqual(LIMITES.composantsParRangee);
    expect(new Set(CATEGORIES_TICKET.map(c => c.cle)).size).toBe(CATEGORIES_TICKET.length);
  });

  test("une catégorie inconnue liste les catégories valables", () => {
    const resultat = verifierOuverture("bidon", "Bonjour");
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toContain("Signalement");
  });

  test("un second ticket RENVOIE vers le premier au lieu de refuser sèchement", () => {
    const resultat = verifierOuverture("aide", "Encore moi", ["1234567890"]);
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.salonExistant).toBe("1234567890");
  });

  test("une ouverture valable rend la catégorie résolue", () => {
    const resultat = verifierOuverture("signalement", "  Un souci  ");
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.categorie.sensible).toBe(true);
    expect(resultat.sujet).toBe("Un souci");
  });

  test("le libellé d'une catégorie ancienne ressort tel quel", () => {
    expect(categorieTicket("aide")?.libelle).toBe("Aide");
    expect(libelleCategorieTicket("ancienne")).toBe("ancienne");
  });
});

describe("identifiants de composants", () => {
  test("aller-retour sans perte", () => {
    expect(lireComposant(identifiantComposant("ouvrir", "signalement"))).toEqual({
      action: "ouvrir",
      argument: "signalement",
    });
    expect(lireComposant(identifiantComposant("fermer"))).toEqual({
      action: "fermer",
      argument: null,
    });
  });

  test("tout ce qui ne vient pas de nous est rejeté", () => {
    expect(lireComposant("autre:ouvrir:aide")).toBeNull();
    expect(lireComposant("ticket:supprimer")).toBeNull();
    expect(lireComposant("ticket")).toBeNull();
    expect(lireComposant(null)).toBeNull();
  });

  test("l'identifiant tient dans la limite dure de l'API", () => {
    const long = identifiantComposant("ouvrir", "x".repeat(200));
    expect(long.length).toBeLessThanOrEqual(LIMITES.identifiantComposant);
  });
});

describe("accès", () => {
  const staff = ["role-mod-1", "role-mod-2"];
  const direction = ["role-direction"];

  test("un ticket ordinaire ne ping QUE la prise en charge, pas la direction", () => {
    const liste = invitations({
      auteurId: "membre",
      rolesDirection: direction,
      pourLaDirection: false,
      rolesStaff: staff,
    });
    expect(liste[0]).toEqual({ genre: "membre", id: "membre", raison: "Auteur du ticket." });
    const roles = liste.filter(e => e.genre === "role").map(e => e.id);
    expect(roles).toEqual(staff);
    expect(roles).not.toContain("role-direction");
  });

  test("un rôle dupliqué dans rolesStaff n'est mentionné qu'une fois", () => {
    const liste = invitations({
      auteurId: "membre",
      rolesDirection: direction,
      pourLaDirection: false,
      rolesStaff: [...staff, "role-mod-1"],
    });
    const roles = liste.filter(e => e.genre === "role").map(e => e.id);
    expect(roles).toEqual(staff);
  });

  test("un ticket réservé à la direction ne va QU'À la direction", () => {
    const liste = invitations({
      auteurId: "membre",
      pourLaDirection: true,
      rolesDirection: direction,
      rolesStaff: staff,
    });
    const roles = liste.filter(e => e.genre === "role").map(e => e.id);
    expect(roles).toEqual(direction);
    expect(roles).not.toContain("role-mod-1");
  });

  test("« sensible » ne décide plus du destinataire — le signalement va à la modération", () => {
    // Décision du 22/8/2026 : le premier vrai signalement notifiait trois
    // membres de la direction et aucun modérateur, pour un incident de vocal.
    const signalement = CATEGORIES_TICKET.find(c => c.cle === "signalement") as (typeof CATEGORIES_TICKET)[number];
    expect(signalement.sensible).toBe(true);
    expect(signalement.pourLaDirection).toBe(false);
    const liste = invitations({
      auteurId: "membre",
      pourLaDirection: signalement.pourLaDirection,
      rolesDirection: direction,
      rolesStaff: staff,
    });
    const roles = liste.filter(e => e.genre === "role").map(e => e.id);
    expect(roles).toEqual(staff);
    expect(roles).not.toContain("role-direction");
  });

  test("sans direction configurée, une catégorie de direction est refusée — pas rabattue", () => {
    const pourLaDirection = { ...CATEGORIES_TICKET[1], pourLaDirection: true } as const;
    const manque = manqueDeConfiguration(pourLaDirection, {
      rolesDirection: [],
      rolesStaff: staff,
    });
    expect(manque).not.toBeNull();
    expect(manque as string).toContain("direction");
  });

  test("un rôle qui lit les tickets sans être habilité est signalé", () => {
    // Le cas réel du 20/8/2026 : `@Staffs` déclaré en prise en charge, donc
    // mentionné, donc AJOUTÉ au fil — 26 personnes dans un ticket d'aide.
    const fuites = fuitesDAcces(
      [
        {
          administrateur: false,
          gereLesFils: true,
          id: "role-mod-1",
          integration: false,
          nom: "@Modérateurs",
          porteursHumains: 3,
        },
        {
          administrateur: false,
          gereLesFils: true,
          id: "role-staffs",
          integration: false,
          nom: "@Staffs",
          porteursHumains: 3,
        },
      ],
      staff,
      "#tickets",
    );
    expect(fuites.avertissements).toHaveLength(1);
    expect(fuites.avertissements[0]).toContain("@Staffs");
    expect(fuites.avertissements[0]).toContain("Gérer les fils");
  });

  test("« Administrateur » est dit à part : aucun salon ne peut le refermer", () => {
    const fuites = fuitesDAcces(
      [
        {
          administrateur: true,
          gereLesFils: false,
          id: "role-fondateur",
          integration: false,
          nom: "@Double des Clés",
          porteursHumains: 3,
        },
      ],
      staff,
      "#tickets",
    );
    expect(fuites.avertissements[0]).toContain("Administrateur");
  });

  test("un rôle que seuls des bots portent n'est pas une fuite", () => {
    const fuites = fuitesDAcces(
      [
        {
          administrateur: true,
          gereLesFils: true,
          id: "role-garde",
          integration: false,
          nom: "@Robot de Garde",
          porteursHumains: 0,
        },
      ],
      staff,
      "#tickets",
    );
    expect(fuites.avertissements).toEqual([]);
  });

  test("les rôles de bots ne sont pas des fuites", () => {
    const fuites = fuitesDAcces(
      [{ administrateur: true, gereLesFils: true, id: "role-bot", integration: true, nom: "@RG", porteursHumains: 3 }],
      staff,
      "#tickets",
    );
    expect(fuites.avertissements).toEqual([]);
  });

  test("une fuite ne bloque JAMAIS : le champ n'existe même pas", () => {
    // Refuser de publier le panneau pour un rôle en trop priverait le serveur
    // de ses tickets pour une raison qui n'a rien à voir avec leur marche.
    const fuites = fuitesDAcces(
      [
        {
          administrateur: false,
          gereLesFils: true,
          id: "role-staffs",
          integration: false,
          nom: "@Staffs",
          porteursHumains: 3,
        },
      ],
      staff,
      "#tickets",
    );
    expect(Object.keys(fuites)).toEqual(["avertissements"]);
  });

  test("sans aucun rôle, même une catégorie ordinaire est refusée", () => {
    const ordinaire = CATEGORIES_TICKET.find(c => !c.pourLaDirection) as (typeof CATEGORIES_TICKET)[number];
    expect(manqueDeConfiguration(ordinaire, { rolesDirection: [], rolesStaff: [] })).not.toBeNull();
    expect(manqueDeConfiguration(ordinaire, { rolesDirection: [], rolesStaff: staff })).toBeNull();
  });
});
