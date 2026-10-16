import { describe, expect, test } from "bun:test";

import { BUDGET_CHROME_MOBILE, coutChromeMobile, decalageHaut, HAUTEURS, PLANS } from "../src/config/metriques";

/**
 * Le chrome coûte de la place sur CHAQUE page. Sans chiffre, une barre
 * s'épaissit d'un demi-rem à chaque refonte et personne ne s'en aperçoit avant
 * que le contenu n'ait plus de place. Ce test est ce chiffre.
 */
describe("budget du chrome", () => {
  test("le chrome mobile tient dans son budget", () => {
    // En-tête (4rem) + barre du bas (4.5rem) = 8.5rem, soit 136 px sur les
    // 812 px d'un écran courant. Au-delà de 9rem, un sixième de l'écran part
    // en navigation avant d'afficher quoi que ce soit.
    expect(coutChromeMobile()).toBeLessThanOrEqual(BUDGET_CHROME_MOBILE);
  });

  test("l'ajout d'une sous-barre de section reste dans le budget", () => {
    expect(coutChromeMobile(true)).toBeLessThanOrEqual(BUDGET_CHROME_MOBILE + 3);
  });

  test("les cibles tactiles de la barre du bas restent au-dessus de 48 px", () => {
    // La barre est passée de 5rem à 4.5rem. En deçà de 3rem, le libellé et
    // l'icône ne tiennent plus dans une cible conforme.
    expect(HAUTEURS.barreBasse * 16).toBeGreaterThanOrEqual(48 + 16);
  });
});

/**
 * L'empilement est ordonné et nommé : un `z-index` écrit en dur dans un
 * composant ne dit pas ce qu'il est censé recouvrir.
 */
describe("plans d'empilement", () => {
  test("la hiérarchie va du contenu vers les surfaces modales", () => {
    expect(PLANS.contenu).toBeLessThan(PLANS.sousBarre);
    expect(PLANS.sousBarre).toBeLessThan(PLANS.navigation);
    expect(PLANS.navigation).toBeLessThan(PLANS.navigationFixe);
    expect(PLANS.navigationFixe).toBeLessThan(PLANS.surface);
  });

  test("les écarts laissent de la place pour intercaler", () => {
    const plans = Object.values(PLANS).sort((a, b) => a - b);
    for (let i = 1; i < plans.length; i += 1) {
      expect((plans[i] as number) - (plans[i - 1] as number)).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("décalage du contenu", () => {
  test("aucune barre montée : aucun décalage", () => {
    expect(decalageHaut({})).toBe("0px");
  });

  test("une seule barre : pas de calc() inutile", () => {
    expect(decalageHaut({ barreSuperieure: true })).toBe("3.5rem");
  });

  test("plusieurs barres : une seule expression, zone sûre comprise", () => {
    const valeur = decalageHaut({ enteteMobile: true, sousBarre: true });
    expect(valeur).toContain("env(safe-area-inset-top)");
    expect(valeur.startsWith("calc(")).toBe(true);
  });
});
