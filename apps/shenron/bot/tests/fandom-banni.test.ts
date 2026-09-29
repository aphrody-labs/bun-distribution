/**
 * fandom-banni.test.ts — Verrou de non-régression sur la source interdite.
 *
 * Fandom a été purgé du dépôt le 2026-09-10 : corpus RAG, bibliographies du
 * wiki, registre des sources et scripts d'ingestion. Ce test échoue si un
 * document, une source ou un crawler Fandom y revient — c'est arrivé une fois
 * par un timer hebdomadaire qui re-crawlait, il n'y a pas de raison que ça ne
 * recommence pas.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCorpusDocs } from "../../../../packages/shenron/pipeline/scripts/_rag-corpus-sources";

const RAG_DIR = join(import.meta.dir, "../data/rag");
const BOT_SCRIPTS = join(import.meta.dir, "../scripts");
const PIPELINE_SCRIPTS = join(import.meta.dir, "../../../../packages/shenron/pipeline/scripts");

/** Un doc du corpus RAG (id + url suffisent à trancher l'origine). */
type Doc = { id: string; url?: string; name?: string };

const corpusFiles = () =>
	existsSync(RAG_DIR)
		? readdirSync(RAG_DIR).filter((f) => f.startsWith("corpus") || f.startsWith("shard"))
		: [];

describe("Fandom reste banni", () => {
	test("aucun document Fandom dans les corpus RAG", () => {
		for (const f of corpusFiles()) {
			const j = JSON.parse(readFileSync(join(RAG_DIR, f), "utf-8")) as { docs?: Doc[] };
			const coupables = (j.docs ?? []).filter(
				(d) => /^fd-(en|fr)-/.test(d.id) || `${d.id} ${d.url ?? ""}`.includes("fandom.com")
			);
			expect({ fichier: f, coupables: coupables.map((d) => d.id) }).toEqual({
				fichier: f,
				coupables: [],
			});
		}
	});

	test("aucun fichier de corpus Fandom sur disque", () => {
		const restes = existsSync(RAG_DIR)
			? readdirSync(RAG_DIR).filter((f) => f.toLowerCase().includes("fandom"))
			: [];
		expect(restes).toEqual([]);
	});

	test("aucun script d'ingestion Fandom", () => {
		const listeRecursive = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
				e.isDirectory() ? listeRecursive(join(dir, e.name)) : [e.name]
			);
		const coupables = [BOT_SCRIPTS, PIPELINE_SCRIPTS]
			.flatMap(listeRecursive)
			.filter((f) => f.toLowerCase().includes("fandom"));
		// Le script de purge est l'outil de l'éradication, pas une ingestion.
		expect(coupables.filter((f) => f !== "purge-fandom-sources.ts")).toEqual([]);
	});

	test("le rendu commun refuse les documents Fandom avant indexation", () => {
		const { passages, refusedFandom } = renderCorpusDocs([
			{ id: "fd-fr-example", name: "Source interdite", url: "https://example.org/article", markdown: "Un contenu pourtant assez long pour être indexé." },
			{ id: "official-example", name: "Source interdite", url: "https://dragonball.fandom.com/wiki/Example", markdown: "Un second contenu assez long pour être indexé." },
		]);
		expect(refusedFandom).toBe(2);
		expect(passages).toEqual([]);
	});
});
