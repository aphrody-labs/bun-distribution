/**
 * Garde-fou du contrat : `@rosegriffon/achillea-types` doit rester une
 * description de données, pas du code.
 *
 * C'est ce qui permet de le traduire mécaniquement en Rust, Swift ou Kotlin
 * (`@rosegriffon/achillea-contract`). Une fonction, un `import` de runtime ou
 * une dépendance glissée ici casserait toutes les cibles natives d'un coup.
 */

import { describe, expect, test } from "bun:test";

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const SRC = join(PACKAGE_ROOT, "src");

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

/** Retire commentaires et littéraux, pour ne scanner que du code. */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1")
    .replace(/`(?:\\.|[^`\\])*`/gu, "``")
    .replace(/'(?:\\.|[^'\\])*'/gu, "''");
}

describe("pureté du contrat", () => {
  test("le paquet n'a aucune dépendance runtime", async () => {
    const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  test("aucune source ne déclare de fonction ni de classe", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const code = stripNonCode(await readFile(file, "utf8"));
      if (/\bfunction\b|\bclass\b|=>/u.test(code)) offenders.push(file.slice(SRC.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  test("aucune source n'importe un runtime ou un framework", async () => {
    const forbidden = [
      /from\s+["']node:/u,
      /from\s+["']bun:/u,
      /from\s+["']@angular\//u,
      /from\s+["']react["']/u,
      /from\s+["']rxjs["']/u,
      /from\s+["']zod["']/u,
    ];
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const code = stripNonCode(await readFile(file, "utf8"));
      if (forbidden.some(pattern => pattern.test(code))) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("tous les imports internes restent dans le paquet", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const code = await readFile(file, "utf8");
      for (const match of code.matchAll(/from\s+["']([^"']+)["']/gu)) {
        const specifier = match[1] as string;
        if (!specifier.startsWith(".")) offenders.push(`${file.slice(SRC.length + 1)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("chaque sous-chemin exporté existe", async () => {
    const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    };
    for (const target of Object.values(manifest.exports)) {
      if (target.includes("*")) continue;
      expect(await Bun.file(join(PACKAGE_ROOT, target)).exists()).toBe(true);
    }
  });
});
