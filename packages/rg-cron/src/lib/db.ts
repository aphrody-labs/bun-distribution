/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SQL } from "bun";
import { createBunSql, createInagleBunSql } from "@rosegriffon/db/bun-sql";

/**
 * Client créé au premier usage, pas à l'import.
 *
 * Le registre est importé par l'API : une base Inagle absente de l'environnement
 * (`INAGLE_DATABASE_URL`) ne doit pas empêcher la fonction de démarrer, seulement
 * faire échouer les tâches qui la lisent.
 */
function paresseux(creer: () => SQL): SQL {
  let instance: SQL | null = null;
  const reel = (): SQL => (instance ??= creer());
  return new Proxy(function () {} as unknown as SQL, {
    apply: (_cible, _this, args) => Reflect.apply(reel() as unknown as (...a: unknown[]) => unknown, undefined, args),
    get: (_cible, propriete) => {
      const valeur = Reflect.get(reel(), propriete);
      return typeof valeur === "function" ? valeur.bind(reel()) : valeur;
    },
  });
}

export const sql = paresseux(() => createBunSql());
export const inagleSql = paresseux(() => createInagleBunSql());
