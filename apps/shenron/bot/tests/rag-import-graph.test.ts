/**
 * B3 : `rag.ts` ne charge plus la génération LLM, et ses clients d'embedding
 * sont paresseux (une URL invalide dégrade en lexical au lieu de jeter à l'import).
 */
import { describe, expect, test } from "bun:test";
import { requireLiveRag } from "@shenron/pipeline/testing/live-rag";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const SRC = resolve(import.meta.dir, "../src");
const RAG = join(SRC, "lib", "rag.ts");
const LLM = join(SRC, "lib", "llm.ts");
const transpiler = new Bun.Transpiler({ loader: "ts" });

/** Fermeture des imports statiques (valeurs, pas types, pas `import()`) internes au bot. */
function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imp of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (imp.kind !== "import-statement" && imp.kind !== "require-call") continue;
      let target = imp.path;
      if (target.startsWith("~/")) target = join(SRC, target.slice(2));
      else if (target.startsWith(".")) target = resolve(dirname(file), target);
      else continue; // paquets : hors du graphe du bot
      const resolved = Bun.resolveSync(target, dirname(file));
      if (resolved.startsWith(SRC + sep) && !resolved.includes(`${sep}node_modules${sep}`)) {
        stack.push(resolved);
      }
    }
  }
  return seen;
}

describe("rag.ts import graph (B3)", () => {
  test("the static import closure of rag.ts does not contain llm.ts", () => {
    const closure = staticClosure(RAG);
    expect(closure.has(RAG)).toBe(true);
    expect(closure.has(LLM)).toBe(false);
    expect(closure.has(join(SRC, "lib", "rag-answer.ts"))).toBe(false);
  });

  test("rag-answer.ts carries the answer helper and imports llm.ts", () => {
    expect(staticClosure(join(SRC, "lib", "rag-answer.ts")).has(LLM)).toBe(true);
  });

  test("an invalid legacy EMBED_URL does not override the configured real hybrid backend", async () => {
    await requireLiveRag();
    const previous = process.env.EMBED_URL;
    try {
      process.env.EMBED_URL = "::not a url::";
      const rag = await import("../src/lib/rag");
      const { results, mode } = await rag.hybridSearch(null, "Goku Saiyan", 5);
      expect(mode).toBe("hybrid");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((hit) => /Goku/i.test(hit.title))).toBe(true);
      expect(results.every((hit) => hit.content?.trim())).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.EMBED_URL;
      else process.env.EMBED_URL = previous;
    }
  });
});
