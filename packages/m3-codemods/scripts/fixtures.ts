// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/fixtures.ts — fixtures des transforms (`__testfixtures__/<nom>.input.tsx` -> `<nom>.output.tsx`).
 *
 * Les fixtures `icons*` passent par `transforms/icons.ts` (hors périmètre de l'orchestrateur), les
 * autres par `transforms/orchestrator.ts`. Les deux côtés sont normalisés par `bun fmt` avant
 * comparaison : on teste la sémantique du codemod, pas le style d'impression.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import icons from "../transforms/icons";
import orchestrator from "../transforms/orchestrator";

// CommonJS (package.json type=commonjs) : __dirname est défini.
export const ROOT = join(__dirname, "..");
export const FIXTURES = join(ROOT, "__testfixtures__");

export interface FixtureCase {
  name: string;
  transform: "orchestrator" | "icons";
  inputPath: string;
  expectedPath: string;
}

export function fixtureCases(): FixtureCase[] {
  return (
    readdirSync(FIXTURES)
      .filter(f => f.endsWith(".input.tsx"))
      .map(f => f.slice(0, -".input.tsx".length))
      // oxlint-disable-next-line unicorn/no-array-sort -- Sorts the fresh array built above (ES2022 target).
      .sort()
      .map(name => ({
        name,
        transform: name.startsWith("icons") ? "icons" : "orchestrator",
        inputPath: join(FIXTURES, `${name}.input.tsx`),
        expectedPath: join(FIXTURES, `${name}.output.tsx`),
      }))
  );
}

/** Sortie brute du transform de la fixture. */
export function runCase(c: FixtureCase, source = readFileSync(c.inputPath, "utf8")): string {
  const transform = c.transform === "icons" ? icons : orchestrator;
  return transform({ path: c.inputPath, source });
}

/** Normalise un source TSX via `bun fmt` (style canonique du dépôt). */
export function format(source: string): string {
  // Formatage d'un fichier temporaire avec la configuration du dépôt.
  const dir = mkdtempSync(join(tmpdir(), "codemod-fixture-"));
  const file = join(dir, "f.tsx");
  try {
    writeFileSync(file, source);
    const run = Bun.spawnSync([process.execPath, "fmt", `--config=${repoConfig()}`, file], {
      windowsHide: true,
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (!run.success) throw new Error(`bun fmt failed (exit ${run.exitCode}): ${run.stderr.toString()}`);
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Remonte l'arborescence jusqu'à la configuration `bun fmt` du dépôt. */
function repoConfig(): string {
  let dir = ROOT;
  for (;;) {
    for (const name of [".oxfmtrc.json", "bun-format.json"]) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("configuration `bun fmt` introuvable au-dessus de ROOT");
    dir = parent;
  }
}
