/**
 * merge-corpus.ts — Fusionne des shards de crawl dans data/rag/corpus.json.
 * Dédupe par `id` : les docs des shards (frais) écrasent les docs existants de
 * même id ; les docs existants sans équivalent sont gardés.
 * Sauvegarde l'ancien corpus avant écriture.
 *
 * Usage : bun scripts/merge-corpus.ts shard-fr.json shard-en.json [...]
 */
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

type Doc = { id: string; name: string; url: string; markdown: string; chars?: number };
const RAG = join(import.meta.dir, "..", "data", "rag");
const CORPUS = join(RAG, "corpus.json");

async function load(path: string): Promise<Doc[]> {
	if (!existsSync(path)) return [];
	const d = JSON.parse(await Bun.file(path).text()) as { docs?: Doc[] };
	return d.docs ?? [];
}

async function main() {
	const shardArgs = process.argv.slice(2);
	const byId = new Map<string, Doc>();

	// 1. Corpus existant en base.
	const existing = await load(CORPUS);
	for (const doc of existing) byId.set(doc.id, doc);
	console.log(`corpus existant: ${existing.length} docs`);

	// 2. Shards (écrasent par id si plus longs/frais).
	let added = 0;
	let updated = 0;
	for (const s of shardArgs) {
		const docs = await load(s.startsWith("/") ? s : join(RAG, s));
		for (const doc of docs) {
			if (!doc.markdown || doc.markdown.length < 200) continue;
			const prev = byId.get(doc.id);
			if (!prev) {
				byId.set(doc.id, doc);
				added++;
			} else if ((doc.markdown.length ?? 0) >= (prev.markdown?.length ?? 0)) {
				byId.set(doc.id, doc);
				updated++;
			}
		}
		console.log(`  ${s}: ${docs.length} docs`);
	}

	const merged = [...byId.values()];
	console.log(`fusion: ${merged.length} docs (+${added} nouveaux, ${updated} mis à jour)`);

	// 3. Backup + écriture.
	if (existsSync(CORPUS)) renameSync(CORPUS, CORPUS + ".bak");
	await Bun.write(
		CORPUS,
		JSON.stringify({ generatedAt: "merged", count: merged.length, docs: merged }, null, 0)
	);
	const mb = (Bun.file(CORPUS).size / 2 ** 20).toFixed(0);
	console.log(`✨ corpus.json écrit: ${merged.length} docs, ${mb} Mo (ancien → corpus.json.bak)`);
}

main().catch((e) => {
	console.error("❌", e);
	process.exit(1);
});
