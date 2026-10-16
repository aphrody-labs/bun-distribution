#!/usr/bin/env bun
/**
 * CLI de génération du contrat.
 *
 *   bun src/cli.ts            écrit `generated/`
 *   bun src/cli.ts --check    échoue si `generated/` est périmé (CI)
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateContract } from "./generate";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES_ROOT = join(PACKAGE_ROOT, "..", "achillea-types", "src");
const OUTPUT_DIR = join(PACKAGE_ROOT, "generated");

async function readTypesVersion(): Promise<string> {
  const manifest = (await Bun.file(join(TYPES_ROOT, "..", "package.json")).json()) as {
    version?: string;
  };
  return manifest.version ?? "0.0.0";
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  const { contract, files } = generateContract({
    root: TYPES_ROOT,
    version: await readTypesVersion(),
  });

  const stale: string[] = [];
  for (const { file, language, content } of files) {
    const target = join(OUTPUT_DIR, file);

    if (check) {
      const existing = Bun.file(target);
      const previous = (await existing.exists()) ? await existing.text() : "";
      if (previous !== content) stale.push(file);
      continue;
    }

    await Bun.write(target, content);
    const lines = content.split("\n").length;
    console.log(`  ✓ ${file.padEnd(24)} ${String(lines).padStart(5)} lignes  — ${language}`);
  }

  const summary = `${contract.declarations.length} déclarations (${contract.source}@${contract.version})`;

  if (check) {
    if (stale.length > 0) {
      console.error(`Contrat périmé : ${stale.join(", ")}`);
      console.error("Régénérer avec : bun --filter @rosegriffon/achillea-contract generate");
      return 1;
    }
    console.log(`Contrat à jour — ${summary}`);
    return 0;
  }

  console.log(`Contrat généré — ${summary}`);
  return 0;
}

process.exit(await main());
