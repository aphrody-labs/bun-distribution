/**
 * Tests de la boîte à suggestions.
 *
 * Le test qui compte vraiment est celui du SCORE : le bot pose lui-même les
 * deux réactions pour amorcer le vote, donc ses propres clics sont dans les
 * compteurs. Oublier de les retirer affiche « 1 pour, 1 contre » sur une
 * suggestion que personne n'a votée — et fausse tout le reste du même écart.
 */
import { describe, expect, test } from "bun:test";

import {
  ETATS_SUGGESTION,
  estEtatSuggestion,
  intentionEtatSuggestion,
  libelleEtatSuggestion,
  libelleScore,
  LONGUEUR_MINIMALE,
  LONGUEUR_SUGGESTION,
  motifSuggestionPropre,
  prochainNumeroSuggestion,
  referenceSuggestion,
  refusTransitionSuggestion,
  score,
  transitionSuggestionPermise,
  validerProposition,
} from "./suggestions";

describe("états", () => {
  test("quatre états, tous habillés", () => {
    for (const etat of ETATS_SUGGESTION) {
      expect(estEtatSuggestion(etat)).toBe(true);
      expect(libelleEtatSuggestion(etat).length).toBeGreaterThan(2);
    }
    expect(libelleEtatSuggestion("zzz")).toBe("⚪ État inconnu");
    expect(intentionEtatSuggestion("zzz")).toBe("marque");
  });

  test("une suggestion écartée peut être ROUVERTE", () => {
    // Le staff change d'avis : l'auteur n'a pas à la reproposer.
    expect(transitionSuggestionPermise("refusee", "ouverte")).toBe(true);
    expect(transitionSuggestionPermise("refusee", "acceptee")).toBe(true);
  });

  test("« faite » est terminal", () => {
    for (const vers of ETATS_SUGGESTION) {
      expect(transitionSuggestionPermise("faite", vers)).toBe(false);
    }
    expect(refusTransitionSuggestion("faite", "ouverte")).toContain("plus rien à décider");
  });

  test("une transition inconnue est refusée, pas devinée", () => {
    expect(transitionSuggestionPermise("ouverte", "archivee")).toBe(false);
    expect(transitionSuggestionPermise("", "")).toBe(false);
  });
});

describe("proposition", () => {
  test("une suggestion argumentée passe", () => {
    const resultat = validerProposition("  Ajouter un salon dédié aux tournois, on en organise deux par mois.  ");
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.texte).toStartWith("Ajouter");
    expect(resultat.texte).toEndWith("mois.");
  });

  test("les retours à la ligne sont CONSERVÉS", () => {
    // Contrairement au sujet d'un ticket : une suggestion argumentée en a
    // besoin, et elle vit dans une description d'embed, qui les accepte.
    const resultat = validerProposition("Première ligne assez longue\nSeconde ligne");
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.texte).toContain("\n");
  });

  test("« plus d'emojis » est refusé, et l'erreur dit pourquoi", () => {
    const resultat = validerProposition("plus emoji");
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.erreur).toContain(String(LONGUEUR_MINIMALE));
  });

  test("un champ vide est refusé", () => {
    expect(validerProposition("   ").ok).toBe(false);
    expect(validerProposition(null).ok).toBe(false);
    expect(validerProposition(42).ok).toBe(false);
  });

  test("une suggestion trop longue est abrégée, jamais refusée", () => {
    const resultat = validerProposition("a".repeat(LONGUEUR_SUGGESTION + 200));
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.texte.length).toBe(LONGUEUR_SUGGESTION);
  });

  test("un motif vide n'existe pas", () => {
    expect(motifSuggestionPropre("  ")).toBeNull();
    expect(motifSuggestionPropre("Déjà prévu pour septembre")).toBe("Déjà prévu pour septembre");
  });
});

describe("numérotation", () => {
  test("la première suggestion porte le numéro 1", () => {
    expect(prochainNumeroSuggestion(null)).toBe(1);
    expect(prochainNumeroSuggestion(0)).toBe(1);
    expect(prochainNumeroSuggestion(11)).toBe(12);
  });

  test("un dernier numéro aberrant ne fait pas régresser la suite", () => {
    expect(prochainNumeroSuggestion(Number.NaN)).toBe(1);
    expect(prochainNumeroSuggestion(-5)).toBe(1);
  });

  test("la référence se cite telle quelle", () => {
    expect(referenceSuggestion(12)).toBe("#012");
  });
});

describe("score", () => {
  test("les réactions du bot sont retirées des deux compteurs", () => {
    // Le cas nu : le bot a réagi, personne d'autre. Le résultat doit être 0/0.
    expect(score(1, 1)).toEqual({ contre: 0, ecart: 0, pour: 0, total: 0 });
  });

  test("un vote humain compte pour un", () => {
    expect(score(4, 1)).toEqual({ contre: 0, ecart: 3, pour: 3, total: 3 });
  });

  test("sans amorce du bot, rien n'est retiré", () => {
    expect(score(3, 1, false)).toEqual({ contre: 1, ecart: 2, pour: 3, total: 4 });
  });

  test("un compteur à zéro ne devient jamais négatif", () => {
    expect(score(0, 0)).toEqual({ contre: 0, ecart: 0, pour: 0, total: 0 });
  });

  test("la ligne de résultat porte le signe de l'écart", () => {
    expect(libelleScore(score(13, 4))).toContain("+9");
    expect(libelleScore(score(2, 6))).toContain("-4");
  });
});
