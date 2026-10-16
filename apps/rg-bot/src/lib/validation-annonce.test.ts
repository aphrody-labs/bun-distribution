/**
 * Tests de la grammaire des boutons de validation d'annonce.
 *
 * C'est la seule partie du palier de validation qui casse SILENCIEUSEMENT.
 * Discord borne le `customId` à 100 caractères : au-delà, le composant est
 * refusé et c'est le message ENTIER qui échoue — la carte de validation
 * n'apparaît pas, personne ne sait qu'un post attendait un arbitrage, et le
 * curseur, lui, a déjà avancé.
 *
 * ⚠ AUCUNE FIXTURE INVENTÉE : `2087918181033574427` est l'identifiant RÉEL du
 * tweet d'annonce d'IERG Day (https://x.com/rose_griffon/status/2087918181033574427).
 */

import { describe, expect, test } from "bun:test";

import { PROFILS } from "./profil";
import {
  decoderValidation,
  encoderValidation,
  MAX_CUSTOM_ID,
  texteCarteTranchee,
  texteCarteValidation,
} from "./validation-annonce";

const TWEET = "2087918181033574427";

/**
 * Salon de destination réel, lu au REGISTRE et non recopié.
 *
 * `profil.test.ts` refuse tout identifiant de guilde ou de salon écrit en dur
 * ailleurs que dans `profil.ts` : un jour où le salon change, un littéral ici
 * ferait passer ce test-ci en décrivant une destination qui n'existe plus.
 */
const SALON_ANNONCE = PROFILS.azalee.annoncePosts!.salonId;

describe("aller-retour d'un identifiant de bouton", () => {
  test("ce qui est encodé se relit à l'identique", () => {
    for (const decision of ["ok", "non"] as const) {
      const id = encoderValidation(TWEET, decision)!;
      expect(decoderValidation(id)).toEqual({ decision, tweetId: TWEET });
    }
  });

  test("l'identifiant tient DANS la limite de Discord", () => {
    // Un composant refusé fait échouer le message entier : la carte
    // n'apparaîtrait pas, et le post attendrait un arbitrage que personne ne
    // sait devoir rendre.
    const id = encoderValidation(TWEET, "ok")!;
    expect(id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID);
  });
});

describe("ce qui est refusé à l'encodage", () => {
  test("un identifiant non numérique ne produit aucun bouton", () => {
    // Un `|` glissé dans la valeur décalerait le décodage : le clic
    // annoncerait un AUTRE post que celui de la carte.
    expect(encoderValidation("12|34", "ok")).toBeNull();
    expect(encoderValidation("abc", "ok")).toBeNull();
    expect(encoderValidation("", "ok")).toBeNull();
  });

  test("un identifiant à rallonge est refusé plutôt que tronqué", () => {
    // Tronquer désignerait un autre post. On préfère ne pas proposer la carte.
    expect(encoderValidation("9".repeat(40), "ok")).toBeNull();
  });
});

describe("ce qui est refusé au décodage", () => {
  test("un bouton étranger n'est jamais traité", () => {
    // Les autres surfaces du bot ont leurs propres préfixes (`tw|`, `cmp|`,
    // `sdg|`…) : les confondre ferait publier une annonce sur un clic de
    // pagination.
    expect(decoderValidation("tw|123|ok")).toBeNull();
    expect(decoderValidation("cmp|iergday|1")).toBeNull();
    expect(decoderValidation("")).toBeNull();
  });

  test("une décision inconnue est refusée", () => {
    expect(decoderValidation(`vann|${TWEET}|peutetre`)).toBeNull();
  });

  test("un nombre de champs inattendu est refusé", () => {
    expect(decoderValidation(`vann|${TWEET}`)).toBeNull();
    expect(decoderValidation(`vann|${TWEET}|ok|extra`)).toBeNull();
  });
});

describe("ce que la carte raconte", () => {
  test("la question nomme l'auteur ET le salon de destination", () => {
    const texte = texteCarteValidation({
      auteur: "Azalee_IE",
      salonAnnonce: SALON_ANNONCE,
      url: `https://x.com/Azalee_IE/status/${TWEET}`,
    });
    expect(texte).toContain("Azalee_IE");
    expect(texte).toContain(`<#${SALON_ANNONCE}>`);
    expect(texte).toContain(TWEET);
  });

  test("un refus dit QUI a écarté", () => {
    const texte = texteCarteTranchee({
      auteur: "Azalee_IE",
      decision: "non",
      parQui: "123",
      url: "https://x.com/Azalee_IE/status/1",
    });
    expect(texte).toContain("écarté");
    expect(texte).toContain("<@123>");
  });

  test("UNE ANNONCE ÉCHOUÉE NE S'AFFICHE PAS COMME UN SUCCÈS", () => {
    // Salon supprimé, permission retirée, panne Discord : une carte qui
    // afficherait « annoncé » ferait croire le post publié, et personne ne le
    // reprendrait.
    const texte = texteCarteTranchee({
      auteur: "Azalee_IE",
      decision: "ok",
      echec: "salon injoignable",
      parQui: "123",
      url: "https://x.com/Azalee_IE/status/1",
    });
    expect(texte).toContain("échoué");
    expect(texte).toContain("salon injoignable");
    expect(texte).not.toMatch(/\bannoncé par\b/);
  });

  test("une annonce réussie dit QUI a validé", () => {
    const texte = texteCarteTranchee({
      auteur: "Azalee_IE",
      decision: "ok",
      parQui: "123",
      url: "https://x.com/Azalee_IE/status/1",
    });
    expect(texte).toContain("annoncé par <@123>");
    expect(texte).not.toContain("échoué");
  });
});
