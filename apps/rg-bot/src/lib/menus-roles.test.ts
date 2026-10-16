/**
 * Tests des menus de rôles.
 *
 * Le cas qui justifie la moitié de ce fichier : un menu déroulant Discord rend
 * la sélection COMPLÈTE, jamais le changement. Un calcul naïf (« pose tout ce
 * qui est coché ») ne retire donc jamais rien, et un membre reste avec un rôle
 * qu'il croit avoir décoché. L'autre moitié garde l'invariant qui compte : ce
 * menu ne touche QUE ses propres rôles.
 */
import { describe, expect, test } from "bun:test";

import {
  entreePropre,
  estFormeMenu,
  identifiantBouton,
  identifiantMenu,
  lireComposant,
  lireEntrees,
  LONGUEURS,
  planDeBascule,
  planDeBouton,
  resumeBascule,
  ROLES_MAX,
} from "./menus-roles";
import { LIMITES } from "./ui/theme";

const R = {
  bleu: "1000000000000000001",
  rouge: "1000000000000000002",
  vert: "1000000000000000003",
  staff: "1086314307383459880",
} as const;

const ENTREES = [
  { description: null, emoji: "🔵", libelle: "Bleu", roleId: R.bleu },
  { description: null, emoji: "🔴", libelle: "Rouge", roleId: R.rouge },
  { description: null, emoji: "🟢", libelle: "Vert", roleId: R.vert },
];

describe("formes", () => {
  test("deux formes, et leurs plafonds sont ceux de l'API", () => {
    expect(estFormeMenu("menu")).toBe(true);
    expect(estFormeMenu("boutons")).toBe(true);
    expect(estFormeMenu("reactions")).toBe(false);
    expect(ROLES_MAX.menu).toBe(25);
    expect(ROLES_MAX.boutons).toBe(LIMITES.composantsParRangee);
  });
});

describe("entrées", () => {
  test("une entrée valable est nettoyée, pas réécrite", () => {
    expect(entreePropre({ emoji: "🔵", libelle: "  Bleu  ", roleId: R.bleu })).toEqual({
      description: null,
      emoji: "🔵",
      libelle: "Bleu",
      roleId: R.bleu,
    });
  });

  test("un rôle qui n'est pas un flocon est refusé", () => {
    expect(entreePropre({ libelle: "Bleu", roleId: "bleu" })).toBeNull();
  });

  test("un libellé vide est refusé — l'API refuserait l'option entière", () => {
    expect(entreePropre({ libelle: "   ", roleId: R.bleu })).toBeNull();
    expect(entreePropre({ libelle: null, roleId: R.bleu })).toBeNull();
  });

  test("un libellé trop long est abrégé aux longueurs de l'API", () => {
    const entree = entreePropre({ libelle: "x".repeat(200), roleId: R.bleu });
    expect(entree?.libelle.length).toBe(LONGUEURS.libelle);
  });

  test("un document de base illisible ne fait pas tomber le menu", () => {
    expect(lireEntrees(null)).toEqual([]);
    expect(lireEntrees("[]")).toEqual([]);
    expect(lireEntrees([1, "deux", null])).toEqual([]);
  });

  test("un rôle en double dans le même menu est écarté", () => {
    // Deux options identiques : l'une des deux ne fait jamais rien, et personne
    // ne sait laquelle.
    const lues = lireEntrees([
      { libelle: "Bleu", roleId: R.bleu },
      { libelle: "Bleu (encore)", roleId: R.bleu },
    ]);
    expect(lues).toHaveLength(1);
    expect(lues[0]?.libelle).toBe("Bleu");
  });
});

describe("identifiants de composants", () => {
  test("aller-retour sans perte", () => {
    expect(lireComposant(identifiantMenu("1400000000000000001"))).toEqual({
      forme: "menu",
      messageId: "1400000000000000001",
      roleId: null,
    });
    expect(lireComposant(identifiantBouton("1400000000000000001", R.bleu))).toEqual({
      forme: "boutons",
      messageId: "1400000000000000001",
      roleId: R.bleu,
    });
  });

  test("tout ce qui ne vient pas de nous est rejeté", () => {
    expect(lireComposant("ticket:ouvrir:aide")).toBeNull();
    expect(lireComposant("roles:menu:pas-un-flocon")).toBeNull();
    expect(lireComposant("roles:bouton:1400000000000000001")).toBeNull();
    expect(lireComposant(null)).toBeNull();
  });

  test("les identifiants tiennent dans la limite dure de l'API", () => {
    expect(identifiantBouton("1400000000000000001", R.bleu).length).toBeLessThanOrEqual(LIMITES.identifiantComposant);
  });
});

describe("bascule par menu déroulant", () => {
  test("la sélection est COMPLÈTE : ce qui n'y est plus est retiré", () => {
    // Le piège du domaine. Un calcul naïf ne retirerait jamais rien.
    const plan = planDeBascule(ENTREES, [R.bleu], [R.bleu, R.rouge]);
    expect(plan.aPoser).toEqual([]);
    expect(plan.aRetirer).toEqual([R.rouge]);
  });

  test("le menu ne touche QUE ses propres rôles", () => {
    // `staff` n'est pas dans le menu : il ne doit ni être posé ni être retiré,
    // quoi que le membre coche.
    const plan = planDeBascule(ENTREES, [R.bleu, R.staff], [R.staff]);
    expect(plan.aPoser).toEqual([R.bleu]);
    expect(plan.aRetirer).toEqual([]);
  });

  test("une sélection identique ne produit aucun appel d'API", () => {
    const plan = planDeBascule(ENTREES, [R.bleu], [R.bleu]);
    expect(plan.aPoser).toEqual([]);
    expect(plan.aRetirer).toEqual([]);
    expect(resumeBascule(plan)).toBe("Rien n'a changé.");
  });

  test("au-delà du plafond, on refuse plutôt que de choisir à sa place", () => {
    const plan = planDeBascule(ENTREES, [R.bleu, R.rouge], [], 1);
    expect(plan.tropDeChoix).toBe(true);
    expect(plan.aPoser).toEqual([]);
    expect(resumeBascule(plan)).toContain("Trop de rôles");
  });

  test("tout décocher retire tout ce que le menu avait posé", () => {
    const plan = planDeBascule(ENTREES, [], [R.bleu, R.vert]);
    expect(plan.aPoser).toEqual([]);
    expect(plan.aRetirer.toSorted()).toEqual([R.bleu, R.vert].toSorted());
  });
});

describe("bascule par bouton", () => {
  test("un rôle non porté est pris", () => {
    expect(planDeBouton(ENTREES, R.bleu, [])).toEqual({
      aPoser: [R.bleu],
      aRetirer: [],
      tropDeChoix: false,
    });
  });

  test("un rôle déjà porté est rendu", () => {
    expect(planDeBouton(ENTREES, R.bleu, [R.bleu])).toEqual({
      aPoser: [],
      aRetirer: [R.bleu],
      tropDeChoix: false,
    });
  });

  test("un rôle hors du menu ne fait rien", () => {
    expect(planDeBouton(ENTREES, R.staff, [R.staff])).toEqual({
      aPoser: [],
      aRetirer: [],
      tropDeChoix: false,
    });
  });

  test("sur un menu à choix unique, le bouton REMPLACE au lieu de refuser", () => {
    // C'est ce qu'un membre attend d'un bouton : il ne voit pas sa sélection,
    // contrairement à un menu déroulant.
    const plan = planDeBouton(ENTREES, R.rouge, [R.bleu], 1);
    expect(plan.aPoser).toEqual([R.rouge]);
    expect(plan.aRetirer).toEqual([R.bleu]);
  });
});

describe("résumé", () => {
  test("il dit ce qui a changé, et le nomme", () => {
    const resume = resumeBascule({ aPoser: [R.bleu], aRetirer: [R.rouge], tropDeChoix: false });
    expect(resume).toContain(`<@&${R.bleu}>`);
    expect(resume).toContain(`<@&${R.rouge}>`);
  });
});
