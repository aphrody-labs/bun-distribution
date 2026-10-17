/**
 * sync-symbol-names.ts — régénère data/material-symbols-names.js depuis la liste
 * canonique du kit de migration (migration/codemods/data/material-symbols-names.json,
 * elle-même issue des codepoints officiels Google).
 *
 * Lancer : bun scripts/sync-symbol-names.ts   (depuis packages/eslint-plugin-m3/)
 */
import { join } from "node:path";

const HERE = import.meta.dir;
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "..", "m3-codemods", "data", "material-symbols-names.json");
const OUT = join(ROOT, "data", "material-symbols-names.js");

const names: string[] = JSON.parse(await Bun.file(SRC).text());
const body =
  "// AUTO-GENERATED depuis migration/codemods/data/material-symbols-names.json.\n" +
  "// Liste officielle des glyphes Material Symbols (Outlined = surensemble des 3 styles).\n" +
  "// Ne pas editer a la main : re-generer via scripts/sync-symbol-names.ts.\n" +
  `export const MATERIAL_SYMBOLS = new Set(${JSON.stringify(names)});\n`;

await Bun.write(OUT, body);
console.log(`material-symbols-names.js régénéré : ${names.length} glyphes.`);
