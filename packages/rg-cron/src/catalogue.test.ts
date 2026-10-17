/**
 * Non-dérive entre le registre des tâches et le catalogue partagé.
 *
 * ── LE DÉFAUT QUE CE FICHIER EMPÊCHE DE REVENIR ────────────────────────────
 * Deux surfaces nomment les mêmes tâches : `REGISTRE_TACHES` (`registry.ts`,
 * le seul endroit qui associe un nom à une fonction) et le catalogue de
 * `@rosegriffon/types/cron`, que le bot, le site et la route `GET /v1/cron`
 * lisent. Recopiées à la main, elles avaient divergé : le bot connaissait
 * dix-huit tâches quand le démon en servait vingt-deux. Ce test les relie.
 */
import { describe, expect, test } from "bun:test";

import { CATALOGUE_TACHES, normaliserNomTache, TACHES_CRON } from "@rosegriffon/types/cron";
import { REGISTRE_TACHES } from "./registry";

const CLEFS = new Set(Object.keys(REGISTRE_TACHES).map(normaliserNomTache));

describe("catalogue partagé vs registre", () => {
  test("toute tâche du catalogue a un exécutant dans le registre", () => {
    const orphelines = TACHES_CRON.filter(nom => !CLEFS.has(normaliserNomTache(nom)));
    expect(orphelines).toEqual([]);
  });

  /**
   * L'inverse n'est PAS symétrique : le registre porte des tâches non publiées,
   * lançables en CLI seulement (`discord:archives`, les veilles X ciblées).
   */
  test("les entrées du registre absentes du catalogue sont connues et assumées", () => {
    const catalogue = new Set(TACHES_CRON.map(normaliserNomTache));
    const tolerees = new Set(["discord:archives", "x", "x:search"]);
    const surplus = [...CLEFS].filter(nom => !catalogue.has(nom) && !tolerees.has(nom));
    expect(surplus).toEqual([]);
  });
});

describe("cohérence interne du catalogue", () => {
  test("aucun doublon de nom", () => {
    expect(new Set(TACHES_CRON).size).toBe(TACHES_CRON.length);
  });

  test("chaque interdiction porte son motif", () => {
    for (const tache of CATALOGUE_TACHES) {
      if (tache.niveau === "interdit") {
        expect(tache.motifInterdiction).toBeTruthy();
      } else {
        expect(tache.motifInterdiction).toBeNull();
      }
    }
  });

  test("une planification est une expression cron ou « manuel »", () => {
    for (const tache of CATALOGUE_TACHES) {
      if (tache.planification === "manuel") {
        continue;
      }
      expect(tache.planification.split(/\s+/)).toHaveLength(5);
    }
  });
});
