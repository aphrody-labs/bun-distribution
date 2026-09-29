/**
 * merge-corpus-shards.ts — Fusionne des shards de crawl dans data/rag/corpus.json (dédoublonnage
 * par id, on garde le markdown le plus riche). Conserve les docs existants non issus du crawl.
 *
 * Usage : bun scripts/merge-corpus-shards.ts /tmp/shard-*.json
 */
import { fileURLToPath } from "node:url";

const CORPUS = fileURLToPath(new URL("../data/rag/corpus.json", import.meta.url));

interface Doc {
	id: string;
	name: string;
	url: string;
	chars: number;
	markdown: string;
}

const byId = new Map<string, Doc>();

// 1. Corpus existant
try {
	const cur = JSON.parse(await Bun.file(CORPUS).text()) as { docs: Doc[] };
	for (const d of cur.docs ?? []) byId.set(d.id, d);
} catch {
	/* nouveau */
}
const before = byId.size;

// 2. Shards
let shardDocs = 0;
for (const path of process.argv.slice(2)) {
	try {
		const shard = JSON.parse(await Bun.file(path).text()) as { docs: Doc[] };
		for (const d of shard.docs ?? []) {
			shardDocs++;
			const prev = byId.get(d.id);
			// garder le plus riche (markdown le plus long)
			if (!prev || (d.markdown?.length ?? 0) > (prev.markdown?.length ?? 0)) byId.set(d.id, d);
		}
		console.log(`[MERGE] ${path}: ${shard.docs?.length ?? 0} docs`);
	} catch (e) {
		console.error(`[MERGE] shard illisible ${path}:`, e);
	}
}

const docs = [...byId.values()];
await Bun.write(
	CORPUS,
	JSON.stringify({ generatedAt: new Date().toISOString(), count: docs.length, docs }, null, 0)
);
const chars = docs.reduce((a, d) => a + (d.markdown?.length ?? 0), 0);
console.log(
	`[MERGE] ${before} -> ${docs.length} docs (${shardDocs} vus dans les shards), ${(chars / 1e6).toFixed(1)} M caractères -> corpus.json`
);
