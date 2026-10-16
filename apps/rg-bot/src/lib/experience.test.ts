/**
 * Tests du noyau de niveaux.
 *
 * Le rôle principal de ce fichier est de FIXER la courbe : un membre qui trouve
 * son niveau bizarre six mois plus tard ne saura jamais quel changement l'a
 * causé. Les points de contrôle ci-dessous viennent du classement **Noctaly**
 * du 1/9/2026 — la référence que la communauté connaît, et sur laquelle la
 * courbe a été alignée.
 *
 *   membre          XP      niveau affiché par Noctaly
 *   Mioleen_        44 580     26
 *   Ichigo Kurosaki 29 045     22
 *   Inazo           20 572     19
 *   LeCrépuscule    12 280     16
 */
import { describe, expect, test } from "bun:test";

import {
  gainDeMessage,
  GAIN_DEFAUT,
  meriteAnnonce,
  messageEligible,
  NIVEAU_MAX,
  niveauPour,
  niveauxFranchis,
  PALIERS_EXPERIENCE,
  jetonsDeMontee,
  prochainRang,
  progression,
  rangDe,
  RANGS,
  XP_NIVEAU_MAX,
  xpPourAtteindre,
} from "./experience";

/** XP cumulée pour ATTEINDRE chaque niveau, avec `5·i² + 50·i + 100` par palier. */
const CONTROLES: ReadonlyArray<[niveau: number, cumule: number]> = [
  [2, 100],
  [5, 770],
  [10, 3_720],
  [16, 11_825],
  [19, 18_375],
  [22, 26_950],
  [25, 37_820],
  [26, 42_000],
  [40, 136_045],
  [60, 425_095],
  [100, 1_845_195],
];

/**
 * Ce que Noctaly affiche, pour les membres dont nous avons l'XP exacte.
 *
 * C'est LE test qui compte : il échouera le jour où quelqu'un retouchera la
 * courbe sans mesurer ce que ça fait au classement que les membres connaissent.
 */
const CLASSEMENT_NOCTALY: ReadonlyArray<[xp: number, niveau: number]> = [
  [44_580, 26],
  [29_045, 22],
  [20_572, 19],
  [12_280, 16],
  [6_086, 12],
];

describe("courbe d'expérience", () => {
  test("les niveaux de Noctaly sont reproduits", () => {
    for (const [xp, niveau] of CLASSEMENT_NOCTALY) {
      expect(niveauPour(xp)).toBe(niveau);
    }
  });

  test("le premier palier coûte 100 XP, comme chez tous les bots de niveaux", () => {
    expect(PALIERS_EXPERIENCE[0]).toBe(100);
    expect(niveauPour(99)).toBe(1);
    expect(niveauPour(100)).toBe(2);
  });

  test("cent paliers, strictement croissants", () => {
    expect(PALIERS_EXPERIENCE).toHaveLength(100);
    for (let index = 1; index < PALIERS_EXPERIENCE.length; index++) {
      expect(PALIERS_EXPERIENCE[index]).toBeGreaterThan(PALIERS_EXPERIENCE[index - 1] as number);
    }
  });

  test("les cumuls sont ceux de la formule, à l'unité près", () => {
    for (const [niveau, cumule] of CONTROLES) {
      expect(xpPourAtteindre(niveau)).toBe(cumule);
    }
  });

  test("le plafond reste à cent niveaux", () => {
    expect(NIVEAU_MAX).toBe(100);
    expect(XP_NIVEAU_MAX).toBe(1_845_195);
  });
});

describe("niveau depuis l'XP", () => {
  test("on commence au niveau 1, sans XP", () => {
    expect(niveauPour(0)).toBe(1);
    expect(niveauPour(99)).toBe(1);
    expect(xpPourAtteindre(1)).toBe(0);
  });

  test("le palier exact fait monter, un point en dessous ne fait pas monter", () => {
    expect(niveauPour(100)).toBe(2);
    expect(niveauPour(99)).toBe(1);
    expect(niveauPour(xpPourAtteindre(50))).toBe(50);
    expect(niveauPour(xpPourAtteindre(50) - 1)).toBe(49);
  });

  test("au-delà du plafond, on reste au plafond", () => {
    expect(niveauPour(XP_NIVEAU_MAX)).toBe(NIVEAU_MAX);
    expect(niveauPour(XP_NIVEAU_MAX * 10)).toBe(NIVEAU_MAX);
  });

  test("une valeur aberrante ne remonte jamais en NaN", () => {
    expect(niveauPour(Number.NaN)).toBe(1);
    expect(niveauPour(-500)).toBe(1);
    expect(xpPourAtteindre(Number.NaN)).toBe(0);
    expect(xpPourAtteindre(10_000)).toBe(XP_NIVEAU_MAX);
  });
});

describe("progression affichable", () => {
  test("au milieu d'un niveau, tout se recoupe", () => {
    const base = xpPourAtteindre(10);
    const p = progression(base + 100);
    expect(p.niveau).toBe(10);
    expect(p.xpDansNiveau).toBe(100);
    expect(p.xpDuNiveau).toBe(PALIERS_EXPERIENCE[9]);
    expect(p.restant).toBe((PALIERS_EXPERIENCE[9] as number) - 100);
    expect(p.ratio).toBeCloseTo(100 / (PALIERS_EXPERIENCE[9] as number), 6);
    expect(p.auMaximum).toBe(false);
  });

  test("au plafond, la barre est pleine et il ne reste rien", () => {
    const p = progression(XP_NIVEAU_MAX + 1_000);
    expect(p.niveau).toBe(NIVEAU_MAX);
    expect(p.auMaximum).toBe(true);
    expect(p.ratio).toBe(1);
    expect(p.restant).toBe(0);
  });
});

describe("niveaux franchis", () => {
  test("aucun franchissement sans changement de niveau", () => {
    expect(niveauxFranchis(0, 99)).toEqual([]);
    expect(niveauxFranchis(1_000, 500)).toEqual([]);
  });

  test("un gain ordinaire franchit un palier", () => {
    expect(niveauxFranchis(90, 110)).toEqual([2]);
  });

  test("un gain exceptionnel rend TOUS les paliers, pas seulement le dernier", () => {
    // Sans ça, les rôles des niveaux intermédiaires ne seraient jamais posés.
    expect(niveauxFranchis(0, xpPourAtteindre(5))).toEqual([2, 3, 4, 5]);
  });
});

describe("rangs", () => {
  test("les quatre libellés viennent des données FR du jeu", () => {
    expect(RANGS.map(rang => rang.nom)).toEqual(["Normal", "Expérimenté", "Héros", "BASARA"]);
  });

  test("chaque niveau tombe dans un rang, bornes comprises", () => {
    expect(rangDe(1).nom).toBe("Normal");
    expect(rangDe(19).nom).toBe("Normal");
    expect(rangDe(20).nom).toBe("Expérimenté");
    expect(rangDe(49).nom).toBe("Expérimenté");
    expect(rangDe(50).nom).toBe("Héros");
    expect(rangDe(79).nom).toBe("Héros");
    expect(rangDe(80).nom).toBe("BASARA");
    expect(rangDe(NIVEAU_MAX).nom).toBe("BASARA");
  });

  test("le prochain rang existe jusqu'au dernier", () => {
    expect(prochainRang(1)?.depuis).toBe(20);
    expect(prochainRang(49)?.depuis).toBe(50);
    expect(prochainRang(80)).toBeNull();
  });
});

describe("filtre d'annonce", () => {
  test("sans montée, rien à annoncer", () => {
    expect(meriteAnnonce(10, 10)).toBe(false);
    expect(meriteAnnonce(10, 9)).toBe(false);
  });

  test("par défaut, un niveau sur cinq seulement", () => {
    // Le cas qui compte : un membre actif monte tous les deux ou trois jours en
    // début de courbe. Sans filtre, deux mille membres rendent le salon
    // illisible en une semaine.
    expect(meriteAnnonce(6, 7)).toBe(false);
    expect(meriteAnnonce(8, 9)).toBe(false);
    expect(meriteAnnonce(9, 10)).toBe(true);
    expect(meriteAnnonce(14, 15)).toBe(true);
  });

  test("un palier TRAVERSÉ compte, pas seulement atterri dessus", () => {
    // Un gain exceptionnel peut sauter par-dessus le multiple.
    expect(meriteAnnonce(9, 11)).toBe(true);
    expect(meriteAnnonce(2, 8)).toBe(true);
  });

  test("un changement de rang s'annonce même hors palier", () => {
    // Niveau 20 = passage de Normal à Expérimenté. Trois fois dans une vie de
    // membre : ça se fête.
    expect(meriteAnnonce(19, 20, { palier: 100 })).toBe(true);
    expect(meriteAnnonce(49, 50, { palier: 100 })).toBe(true);
    expect(meriteAnnonce(79, 80, { palier: 100 })).toBe(true);
    expect(meriteAnnonce(19, 20, { annoncerRang: false, palier: 100 })).toBe(false);
  });

  test("palier 1 rétablit l'annonce à chaque niveau", () => {
    expect(meriteAnnonce(6, 7, { palier: 1 })).toBe(true);
  });

  test("un palier aberrant ne fait pas tout passer", () => {
    expect(meriteAnnonce(6, 7, { annoncerRang: false, palier: 0 })).toBe(true);
    expect(meriteAnnonce(6, 7, { annoncerRang: false, palier: Number.NaN })).toBe(false);
  });
});

describe("gain d'un message", () => {
  test("le défaut donne 20 XP, quel que soit le tirage", () => {
    // Règle de Noctaly, affichée sur son classement : « Toutes les 60
    // secondes, tu peux envoyer un message pour obtenir 20 XP ». Bornes
    // égales, donc aucun hasard — mais le tirage reste opérant si on les
    // écarte de nouveau (test suivant).
    for (const tirage of [0, 0.25, 0.5, 0.999_999]) {
      expect(gainDeMessage(GAIN_DEFAUT, tirage)).toBe(20);
    }
  });

  test("une fourchette élargie retrouve un tirage sur toute son étendue", () => {
    const large = { delaiSecondes: 60, maximum: 25, minimum: 15 };
    expect(gainDeMessage(large, 0)).toBe(15);
    expect(gainDeMessage(large, 0.999_999)).toBe(25);
  });

  test("une fourchette inversée ne rend jamais moins que son minimum", () => {
    expect(gainDeMessage({ delaiSecondes: 60, maximum: 5, minimum: 20 }, 0.9)).toBe(20);
  });

  test("un tirage aberrant ne casse pas le gain", () => {
    expect(gainDeMessage(GAIN_DEFAUT, Number.NaN)).toBe(20);
    expect(gainDeMessage(GAIN_DEFAUT, 42)).toBe(20);
  });

  test("le premier message d'un membre rapporte toujours", () => {
    expect(messageEligible(null)).toBe(true);
    expect(messageEligible(undefined)).toBe(true);
    expect(messageEligible("pas une date")).toBe(true);
  });

  test("le délai anti-spam se compte à la seconde près", () => {
    const maintenant = new Date("2026-08-14T12:01:00.000Z");
    expect(messageEligible("2026-08-14T12:00:00.000Z", maintenant, 60)).toBe(true);
    expect(messageEligible("2026-08-14T12:00:01.000Z", maintenant, 60)).toBe(false);
  });

  test("les points de montée croissent avec le niveau", () => {
    expect(jetonsDeMontee(1)).toBe(10);
    expect(jetonsDeMontee(50)).toBe(500);
    expect(jetonsDeMontee(50, 0)).toBe(0);
  });
});
