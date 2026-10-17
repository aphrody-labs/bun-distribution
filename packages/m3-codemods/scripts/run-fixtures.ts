// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/run-fixtures.ts — test rapide des transforms sur les fixtures.
 *
 * Pour chaque `<name>.input.tsx` de `__testfixtures__/`, applique son transform (en
 * mémoire, sans sous-processus hors `bun fmt`) et compare au `<name>.output.tsx` attendu.
 * Sortie non-zero si un écart.
 *
 * Lancer : `bun run scripts/run-fixtures.ts`
 * Régénérer les attendus : `bun run scripts/run-fixtures.ts --update`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fixtureCases, format, runCase } from "./fixtures";

const update = process.argv.includes("--update");

let failures = 0;
for (const c of fixtureCases()) {
  const actual = format(runCase(c));
  if (update) {
    writeFileSync(c.expectedPath, actual);
    console.log(`UPDATED ${c.name}.output.tsx`);
    continue;
  }
  const expected = format(readFileSync(c.expectedPath, "utf8"));
  if (actual === expected) {
    console.log(`PASS  ${c.name}`);
    continue;
  }
  failures++;
  console.log(`FAIL  ${c.name}`);
  // petit diff ligne à ligne
  const a = actual.split("\n");
  const e = expected.split("\n");
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) {
      console.log(`  L${i + 1}\n   attendu: ${JSON.stringify(e[i])}\n   obtenu : ${JSON.stringify(a[i])}`);
    }
  }
}

if (!update && failures > 0) {
  console.error(`\n${failures} fixture(s) en échec.`);
  process.exit(1);
}
console.log(update ? "\nFixtures régénérées." : "\nTous les fixtures passent.");
