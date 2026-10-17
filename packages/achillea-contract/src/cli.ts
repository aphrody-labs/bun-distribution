#!/usr/bin/env bun
/**
 * CLI de génération du contrat.
 *
 *   bun src/cli.ts            écrit `generated/`
 *   bun src/cli.ts --check    échoue si `generated/` est périmé (CI)
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { generateContract } from "./generate";

/**
 * Package root: `ACHILLEA_CONTRACT_ROOT`, else the source checkout next to this module, else the working directory
 * (the package itself or the workspace root). A compiled binary has no module directory on disk, so it relies on
 * the last two.
 */
function packageRoot(): string {
  const explicit = process.env.ACHILLEA_CONTRACT_ROOT?.trim();
  if (explicit) return resolve(explicit);
  const candidates = [join(import.meta.dir, ".."), process.cwd(), join(process.cwd(), "packages", "achillea-contract")];
  const root = candidates.find(
    candidate => existsSync(join(candidate, "generated")) && existsSync(join(candidate, "..", "achillea-types", "src")),
  );
  if (!root) throw new Error("achillea-contract root not found: run it from the package or the workspace root");
  return root;
}

const PACKAGE_ROOT = packageRoot();
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
