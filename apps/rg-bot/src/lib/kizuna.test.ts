/**
 * Tests de l'économie des jetons Kizuna.
 *
 * Ce qui est vérifié ici n'est pas de l'arithmétique : ce sont les règles qui
 * décident si un membre se sent lésé. Une série rompue par un fuseau, un don
 * qui passe à découvert, un plafond qui refuse sans dire ce qui reste — chacun
 * de ces cas a son test.
 */
import { describe, expect, test } from "bun:test";

import {
  DON,
  estMotif,
  etatQuotidien,
  formaterDelta,
  formaterJetons,
  jourCivil,
  libelleMotif,
  libelleUnite,
  MOTIFS,
  QUOTIDIEN,
  recompenseQuotidienne,
  validerDon,
  verifierDepense,
} from "./kizuna";

const LE_14 = new Date("2026-08-14T12:00:00.000Z");

describe("vocabulaire du journal", () => {
  test("chaque motif a son libellé, et rien d'autre n'en est un", () => {
    for (const motif of MOTIFS) {
      expect(estMotif(motif)).toBe(true);
      expect(libelleMotif(motif).length).toBeGreaterThan(0);
      expect(libelleMotif(motif)).not.toBe(motif);
    }
    expect(estMotif("divers")).toBe(false);
    // Un motif inconnu ressort tel quel plutôt que d'être masqué : si la base
    // en porte un jour un autre, on veut le VOIR.
    expect(libelleMotif("divers")).toBe("divers");
  });
});

describe("affichage", () => {
  test("l'unité s'accorde", () => {
    expect(libelleUnite(1)).toBe("jeton Kizuna");
    expect(libelleUnite(0)).toBe("jeton Kizuna");
    expect(libelleUnite(2)).toBe("jetons Kizuna");
  });

  test("les milliers sont groupés avec une espace ordinaire", () => {
    // Espace ordinaire et non l'espace fine insécable de `toLocaleString` :
    // c'est ce qui rend la valeur comparable dans un test.
    expect(formaterJetons(1250)).toBe("1 250 jetons Kizuna");
    expect(formaterJetons(null)).toBe("0 jeton Kizuna");
  });

  test("le signe d'un delta est toujours visible", () => {
    expect(formaterDelta(40)).toBe("+40");
    expect(formaterDelta(-15)).toBe("−15");
    expect(formaterDelta(0)).toBe("0");
  });
});

describe("passage quotidien", () => {
  test("le premier passage rapporte la base", () => {
    const etat = etatQuotidien(null, 0, LE_14);
    expect(etat.reclamable).toBe(true);
    expect(etat.serie).toBe(1);
    expect(etat.gain).toBe(QUOTIDIEN.base);
    expect(etat.serieRompue).toBe(false);
  });

  test("un passage la veille poursuit la série", () => {
    const etat = etatQuotidien("2026-08-13", 4, LE_14);
    expect(etat.reclamable).toBe(true);
    expect(etat.serie).toBe(5);
    expect(etat.gain).toBe(recompenseQuotidienne(5));
    expect(etat.serieRompue).toBe(false);
  });

  test("deux jours d'absence rompent la série, et on le dit", () => {
    const etat = etatQuotidien("2026-08-12", 9, LE_14);
    expect(etat.reclamable).toBe(true);
    expect(etat.serie).toBe(1);
    expect(etat.serieRompue).toBe(true);
  });

  test("le même jour, plus rien — et la série reste intacte", () => {
    const etat = etatQuotidien("2026-08-14", 7, LE_14);
    expect(etat.reclamable).toBe(false);
    expect(etat.gain).toBe(0);
    expect(etat.serie).toBe(7);
    expect(etat.serieRompue).toBe(false);
  });

  test("la fenêtre ne GLISSE pas : réclamer à 23 h autorise 1 h le lendemain", () => {
    // Avec un délai de 24 h, ce cas serait refusé — c'est exactement le piège
    // qui casse les séries honnêtes.
    const tard = new Date("2026-08-13T23:00:00.000Z");
    const tot = new Date("2026-08-14T01:00:00.000Z");
    expect(etatQuotidien(jourCivil(tard), 3, tot).reclamable).toBe(true);
  });

  test("une date future en base ne récompense pas et ne casse rien", () => {
    const etat = etatQuotidien("2026-08-20", 6, LE_14);
    expect(etat.reclamable).toBe(false);
    expect(etat.serie).toBe(6);
  });

  test("le prochain passage est minuit UTC du lendemain", () => {
    expect(etatQuotidien("2026-08-14", 1, LE_14).prochain.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  test("la prime de série plafonne au onzième jour", () => {
    expect(recompenseQuotidienne(1)).toBe(QUOTIDIEN.base);
    expect(recompenseQuotidienne(2)).toBe(QUOTIDIEN.base + QUOTIDIEN.parJour);
    expect(recompenseQuotidienne(11)).toBe(QUOTIDIEN.base + QUOTIDIEN.primeMaximale);
    expect(recompenseQuotidienne(400)).toBe(QUOTIDIEN.base + QUOTIDIEN.primeMaximale);
  });
});

describe("dons", () => {
  const base = { destinataireId: "b", expediteurId: "a", solde: 1_000 };

  test("un don ordinaire passe", () => {
    const resultat = validerDon({ ...base, montant: 250 });
    expect(resultat).toEqual({ montant: 250, ok: true });
  });

  test("on ne se donne pas à soi-même", () => {
    const resultat = validerDon({ ...base, destinataireId: "a", montant: 10 });
    expect(resultat.ok).toBe(false);
  });

  test("un bot n'est pas un destinataire", () => {
    const resultat = validerDon({ ...base, destinataireEstBot: true, montant: 10 });
    expect(resultat.ok).toBe(false);
  });

  test("le montant doit être un entier", () => {
    expect(validerDon({ ...base, montant: 4.5 }).ok).toBe(false);
    expect(validerDon({ ...base, montant: "beaucoup" }).ok).toBe(false);
    // Une saisie avec une espace de groupement reste comprise.
    expect(validerDon({ ...base, montant: "1 000" })).toEqual({ montant: 1_000, ok: true });
  });

  test("les bornes du don unique sont dites, pas devinées", () => {
    expect(validerDon({ ...base, montant: 0 }).ok).toBe(false);
    const trop = validerDon({ ...base, montant: DON.maximum + 1, solde: 1_000_000 });
    expect(trop.ok).toBe(false);
    if (trop.ok) return;
    expect(trop.erreur).toContain("5 000");
  });

  test("à découvert, l'erreur dit ce qui MANQUE", () => {
    const resultat = validerDon({ ...base, montant: 1_500, solde: 400 });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toContain("1 100");
  });

  test("le plafond journalier annonce le reste disponible", () => {
    const resultat = validerDon({
      ...base,
      dejaDonne: DON.plafondJournalier - 100,
      montant: 500,
      solde: 50_000,
    });
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toContain("100 jetons");
  });
});

describe("dépenses", () => {
  test("payer laisse le solde exact", () => {
    expect(verifierDepense(500, 200)).toEqual({ ok: true, soldeApres: 300 });
  });

  test("un prix nul est toujours payable", () => {
    expect(verifierDepense(0, 0)).toEqual({ ok: true, soldeApres: 0 });
  });

  test("quand ça ne passe pas, on rend le manque chiffré", () => {
    const resultat = verifierDepense(120, 500);
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.manque).toBe(380);
    expect(resultat.erreur).toContain("380");
  });
});
