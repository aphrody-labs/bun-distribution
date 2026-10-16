// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/codemod.ts — applique un transform de `transforms/` à des fichiers.
 *
 *   bun scripts/codemod.ts <orchestrator|mui-imports|button|fields|icons> <fichier|glob>... [--dry]
 *
 * `--dry` affiche les fichiers qui changeraient sans les écrire.
 */
/* oxlint-disable no-await-in-loop -- fichiers traités un par un, journal dans l'ordre */
import { join } from "node:path";
import type { FileInfo } from "../lib/engine";

const TRANSFORMS = [
  "orchestrator",
  "mui-imports",
  "button",
  "fields",
  "icons",
] as const;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [name, ...patterns] = args.filter((a) => a !== "--dry");
if (!name || !TRANSFORMS.includes(name as never) || patterns.length === 0) {
  console.error(
    `usage: bun scripts/codemod.ts <${TRANSFORMS.join("|")}> <fichier|glob>... [--dry]`,
  );
  process.exit(2);
}

const transform: (file: FileInfo) => string = (
  await import(join(__dirname, "..", "transforms", `${name}.ts`))
).default;

let changed = 0;
let failed = 0;
for (const pattern of patterns) {
  const files = (await Bun.file(pattern).exists())
    ? [pattern]
    : [...new Bun.Glob(pattern).scanSync(".")];
  for (const path of files) {
    const source = await Bun.file(path).text();
    try {
      const out = transform({ path, source });
      if (out === source) continue;
      changed++;
      if (!dry) await Bun.write(path, out);
      console.log(`${dry ? "changerait" : "modifié"} ${path}`);
    } catch (error) {
      failed++;
      console.error(
        `ERREUR ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
console.log(
  `${changed} fichier(s) ${dry ? "à modifier" : "modifié(s)"}, ${failed} erreur(s).`,
);
if (failed > 0) process.exit(1);
