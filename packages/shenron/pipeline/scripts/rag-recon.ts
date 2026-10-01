/**
 * rag-recon.ts — Scrape toutes nos sources Dragon Ball via Aphrody Web
 * (HTML → Markdown propre) et agrège dans un gros JSON + fichiers .md.
 *
 * Sources = table db_sources + seeds high-value (Wikipédia, sources officielles).
 * Fandom est exclu : source interdite pour rédiger (cf. CLAUDE.md).
 * Sortie : apps/shenron/bot/data/rag/<slug>.md + apps/shenron/bot/data/rag/corpus.json
 * (base de connaissances pour un futur RAG / recherche).
 *
 * Usage : bun apps/shenron/bot/scripts/rag-recon.ts
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

import { aphrodyWebScrape } from "@shenron/pipeline/aphrody";

const DB = new URL("../data/bot.db", import.meta.url).pathname;
const OUT = new URL("../data/rag/", import.meta.url).pathname;
const WEB_PROFILE = process.env.APHRODY_WEB_PROFILE ?? process.env.BXC_PROFILE ?? "max";
mkdirSync(OUT, { recursive: true });

const db = new Database(DB, { readonly: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sources = db.query(`SELECT id, name, url FROM db_sources WHERE url LIKE 'http%'`).all() as {
	id: string;
	name: string;
	url: string;
}[];

// Seeds high-value (pages riches en texte, pas juste des landing pages)
const SEEDS: { id: string; name: string; url: string }[] = [
	{
		id: "wiki-dbz",
		name: "Dragon Ball Z (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Dragon_Ball_Z",
	},
	{
		id: "wiki-db",
		name: "Dragon Ball (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Dragon_Ball",
	},
	{
		id: "wiki-dbsuper",
		name: "Dragon Ball Super (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Dragon_Ball_Super",
	},
	{
		id: "wiki-toriyama",
		name: "Akira Toriyama (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Akira_Toriyama",
	},
];

async function recon(url: string): Promise<string | null> {
	try {
		const markdown = await aphrodyWebScrape(url, { profile: WEB_PROFILE as "static" | "http" | "fast" | "stealth" | "max" });
		return markdown.length >= 50 ? markdown : null;
	} catch {
		return null;
	}
}

async function main() {
	const all = [...sources, ...SEEDS];
	const corpus: Array<{
		id: string;
		name: string;
		url: string;
		chars: number;
		markdown: string;
	}> = [];
	for (const s of all) {
		let md: string | null = null;
		for (let a = 0; a < 2 && !md; a++) {
			md = await recon(s.url);
			if (!md) await sleep(1500);
		}
		await sleep(800);
		if (!md) {
			console.log(`✗ ${s.id} — recon KO (${s.url})`);
			continue;
		}
		writeFileSync(`${OUT}${s.id}.md`, md);
		corpus.push({
			id: s.id,
			name: s.name,
			url: s.url,
			chars: md.length,
			markdown: md,
		});
		console.log(`✓ ${s.id} — ${md.length} chars`);
	}
	writeFileSync(
		`${OUT}corpus.json`,
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				count: corpus.length,
				docs: corpus,
			},
			null,
			0
		)
	);
	console.log(`\n${corpus.length}/${all.length} sources → ${OUT}corpus.json`);
	db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
