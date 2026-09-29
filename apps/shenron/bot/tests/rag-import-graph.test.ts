/**
 * B3 : `rag.ts` ne charge plus la génération LLM, et ses clients d'embedding
 * sont paresseux (une URL invalide dégrade en lexical au lieu de jeter à l'import).
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
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

	test("an invalid EMBED_URL neither throws at import nor breaks search (lexical fallback)", async () => {
		const saved = {
			EMBED_URL: process.env.EMBED_URL,
			APHRODY_SHENRON_EMBED_BASE_URL: process.env.APHRODY_SHENRON_EMBED_BASE_URL,
			APHRODY_SHENRON_API_URL: process.env.APHRODY_SHENRON_API_URL,
			APHRODY_SHENRON_API_TOKEN: process.env.APHRODY_SHENRON_API_TOKEN,
			RAG_BACKEND: process.env.RAG_BACKEND,
			RERANK_URL: process.env.RERANK_URL,
		};
		process.env.EMBED_URL = "::not a url::";
		for (const name of [
			"APHRODY_SHENRON_EMBED_BASE_URL",
			"APHRODY_SHENRON_API_URL",
			"APHRODY_SHENRON_API_TOKEN",
			"RAG_BACKEND",
			"RERANK_URL",
		]) {
			delete process.env[name];
		}
		const db = new Database(":memory:");
		try {
			const rag = await import("../src/lib/rag");
			rag.resetQueryEmbeddingModel();
			expect(rag.queryEmbeddingModel().model).toBeNull();
			expect(await rag.embedQueryVector("Goku")).toBeNull();

			db.run(
				"CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity, tokenize='unicode61 remove_diacritics 2')"
			);
			db.run(
				"INSERT INTO rag_chunks (rowid, kind, title, url, content, lang, source_id, entity) VALUES (1, 'character', 'Goku', '/wiki/goku', 'Goku est un guerrier Saiyan.', 'fr', 'db_characters', 'Goku')"
			);
			const { results, mode } = await rag.hybridSearch(db, "Goku Saiyan", 5);
			expect(mode).toBe("lexical");
			expect(results.map((r) => r.title)).toContain("Goku");
		} finally {
			db.close();
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
			(await import("../src/lib/rag")).resetQueryEmbeddingModel();
		}
	});
});
