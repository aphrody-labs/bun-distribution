/**
 * Tests du noyau de collection.
 *
 * Les valeurs de rareté testées ici sont celles que la base rend RÉELLEMENT :
 * `inagle_characters.rarity` est une colonne `text`, pas un entier (une
 * comparaison `rarity = 20` lève `operator does not exist: text = integer`).
 * Le noyau doit donc accepter les deux formes sans broncher — c'est le genre de
 * détail qui casse une commande six mois après, sur un seul type de joueur.
 */
import { describe, expect, test } from "bun:test";

import {
  CATEGORIES,
  EQUIPE_MAX,
  estCategorie,
  garantieAuTirage,
  garantiesDansSalve,
  libelleCategorie,
  libelleCompletion,
  ordreRarete,
  palierDePlaque,
  prixDePlaque,
  RARETES,
  rareteDe,
  remboursementDoublon,
  resumerCollection,
  TARIFS,
} from "./collection";

describe("raretés", () => {
  test("l'échelle est celle du jeu, du plus commun au plus rare", () => {
    expect(RARETES.map(rarete => rarete.nom)).toEqual(["Normal", "Expérimenté", "Héros", "BASARA"]);
    expect(RARETES.map(rarete => rarete.code)).toEqual([0, 2, 10, 20]);
  });

  test("le code arrive en texte depuis Postgres et doit être compris", () => {
    expect(rareteDe("20").nom).toBe("BASARA");
    expect(rareteDe(20).nom).toBe("BASARA");
    expect(rareteDe("2").nom).toBe("Expérimenté");
  });

  test("une rareté inconnue retombe sur Normal plutôt que sur undefined", () => {
    expect(rareteDe(null).nom).toBe("Normal");
    expect(rareteDe("mythique").nom).toBe("Normal");
    expect(rareteDe(undefined).nom).toBe("Normal");
  });

  test("seules les deux plus hautes valent une annonce publique", () => {
    expect(rareteDe(0).remarquable).toBe(false);
    expect(rareteDe(2).remarquable).toBe(false);
    expect(rareteDe(10).remarquable).toBe(true);
    expect(rareteDe(20).remarquable).toBe(true);
  });

  test("l'ordre permet de trier du plus rare au plus commun", () => {
    expect(ordreRarete("20")).toBeGreaterThan(ordreRarete("10"));
    expect(ordreRarete("10")).toBeGreaterThan(ordreRarete("0"));
  });

  test("le remboursement d'un doublon croît avec la rareté", () => {
    const montants = RARETES.map(rarete => remboursementDoublon(rarete.code));
    for (let index = 1; index < montants.length; index++) {
      expect(montants[index]).toBeGreaterThan(montants[index - 1] as number);
    }
    // Un doublon Normal ne doit jamais rapporter plus qu'il n'a coûté, sinon
    // tirer en boucle deviendrait une machine à points.
    expect(remboursementDoublon(0)).toBeLessThan(TARIFS.tirage);
  });
});

describe("garantie", () => {
  test("un tirage sur dix, compté sur le total", () => {
    expect(garantieAuTirage(0)).toBe(false);
    // Neuf tirages déjà faits → le dixième est garanti.
    expect(garantieAuTirage(9)).toBe(true);
    expect(garantieAuTirage(10)).toBe(false);
    expect(garantieAuTirage(19)).toBe(true);
  });

  test("une salve de dix contient exactement une garantie, où qu'elle commence", () => {
    for (const depart of [0, 3, 7, 9, 25, 137]) {
      expect(garantiesDansSalve(depart)).toHaveLength(1);
    }
  });

  test("la salve neuve garantit son dernier tirage", () => {
    expect(garantiesDansSalve(0)).toEqual([9]);
  });

  test("tirer un par un ne fait pas perdre la garantie", () => {
    // C'est la raison du compteur GLOBAL : avec un compteur remis à zéro par
    // salve, neuf tirages à l'unité puis une salve donneraient deux garanties.
    const unParUn = Array.from({ length: 10 }, (_, index) => garantieAuTirage(index)).filter(Boolean);
    expect(unParUn).toHaveLength(1);
  });

  test("la salve coûte moins cher que dix tirages à l'unité", () => {
    expect(TARIFS.tirageDix).toBeLessThan(TARIFS.tirage * TARIFS.salve);
  });
});

describe("plaques", () => {
  test("le prix suit le rang de déblocage du jeu", () => {
    expect(prixDePlaque(1)).toBe(300);
    expect(prixDePlaque(10)).toBe(300);
    expect(prixDePlaque(11)).toBe(900);
    expect(prixDePlaque(25)).toBe(900);
    expect(prixDePlaque(26)).toBe(2_000);
    expect(prixDePlaque(41)).toBe(4_500);
    // 54 plaques en base : la dernière doit tomber dans le dernier palier.
    expect(prixDePlaque(54)).toBe(4_500);
  });

  test("chaque palier porte un nom lisible dans la boutique", () => {
    expect(palierDePlaque(1).nom).toBe("Débutant");
    expect(palierDePlaque(54).nom).toBe("Légende");
  });

  test("un rang absent ou aberrant tombe sur le premier palier", () => {
    expect(prixDePlaque(null)).toBe(300);
    expect(prixDePlaque(Number.NaN)).toBe(300);
    expect(prixDePlaque(0)).toBe(300);
  });
});

describe("catégories", () => {
  test("deux familles, et rien d'autre", () => {
    expect([...CATEGORIES]).toEqual(["perso", "plaque"]);
    expect(estCategorie("perso")).toBe(true);
    expect(estCategorie("emblème")).toBe(false);
    expect(libelleCategorie("plaque")).toBe("Plaque de nom");
    expect(libelleCategorie("inconnue")).toBe("inconnue");
  });

  test("onze titulaires, comme sur un terrain", () => {
    expect(EQUIPE_MAX).toBe(11);
  });
});

describe("résumé d'une collection", () => {
  test("les raretés vides restent affichées", () => {
    const resume = resumerCollection([{ objetId: "a", rarete: "0" }], 6_148);
    expect(resume.parRarete).toHaveLength(RARETES.length);
    expect(resume.parRarete.map(entree => entree.nombre)).toEqual([1, 0, 0, 0]);
  });

  test("le compte suit les raretés réelles", () => {
    const resume = resumerCollection(
      [
        { objetId: "a", rarete: "0" },
        { objetId: "b", rarete: "20" },
        { objetId: "c", rarete: "20" },
        { objetId: "d", rarete: "10" },
      ],
      6_148,
    );
    expect(resume.total).toBe(4);
    expect(resume.parRarete.map(entree => entree.nombre)).toEqual([1, 0, 1, 2]);
  });

  test("la complétion est bornée et ne divise jamais par zéro", () => {
    expect(resumerCollection([], 0).completion).toBe(0);
    expect(resumerCollection([{ objetId: "a", rarete: 0 }], 1).completion).toBe(1);
  });

  test("la ligne de complétion se lit d'un coup d'œil", () => {
    const resume = resumerCollection([{ objetId: "a", rarete: 0 }], 6_148);
    expect(libelleCompletion(resume, 6_148)).toBe("1 sur 6 148 · 0 %");
  });
});
