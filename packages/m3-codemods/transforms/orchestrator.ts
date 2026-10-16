// SPDX-License-Identifier: Apache-2.0
/**
 * transforms/orchestrator.ts — transform ORCHESTRATEUR (tout-en-un).
 *
 * Lance le moteur complet sur l'intégralité du mapping (00-CONVENTIONS.md §3) :
 * imports + JSX + props + slots + gaps. C'est l'entrée recommandée pour une
 * migration de masse ; les transforms `button.ts` / `fields.ts` servent à
 * migrer par lots ciblés.
 *
 * Équivalent fonctionnel à `mui-imports.ts` (pas de `only`), mais nommé
 * explicitement comme l'orchestrateur attendu par le kit.
 *
 * Usage :
 *   bun scripts/codemod.ts orchestrator 'src/**\/*.tsx'
 */
import { runEngine, type FileInfo, type Options } from "../lib/engine";

export default function transformer(
  file: FileInfo,
  api?: unknown,
  options: Options = {},
): string {
  return runEngine(file, api, options);
}

export const parser = "tsx";
