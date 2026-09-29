/**
 * crawl-kanzenshuu-rag.ts — Crawl des sections de référence de kanzenshuu.com
 * (Daizenshuu & autres databooks officiels, guides) vers un shard RAG.
 *
 * Kanzenshuu = la référence anglophone autoritaire (traductions des guidebooks
 * officiels DB : profils, power levels, timelines, interviews). BFS scopé aux
 * chemins de référence, extraction de `<main id="content">`. Pas de blog/tags/
 * forum/media.
 *
 * Usage : bun scripts/crawl-kanzenshuu-rag.ts [--max 300] [--out shard-kanzenshuu.json]
 */
import { join } from "node:path";
import { scrapeWithAphrody } from "./lib/aphrody-web-scrape.ts";

const arg = (k: string, d?: string) => {
	const i = process.argv.indexOf(`--${k}`);
	return i !== -1 ? process.argv[i + 1] : d;
};
const MAX = Number(arg("max", "350"));
const OUT = arg("out", join(import.meta.dir, "..", "data", "rag", "shard-kanzenshuu.json"))!;
const CONC = 6;
const BASE = "https://www.kanzenshuu.com";

const SEEDS = [
	"/databook/",
	"/databook/daizenshuu/",
	"/databook/super-exciting-guide/",
	"/databook/tv-animation-part/",
];
// Chemins de référence à suivre ; on exclut blog daté, tags, forum, médias.
const INCLUDE =
	/^\/(databook|guidebook|encyclopedia|guide|references?|anime|manga|movies?|tidbits)\b/i;
const EXCLUDE =
	/\/(tag|category|author|forum|feed|wp-|page)\b|\/\d{4}\/\d{2}\/|\.(css|js|png|jpe?g|gif|svg|webp|ico|pdf|zip|mp[34])(\?|$)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractText(html: string): string {
	let m = html.match(/<main[^>]*id="content"[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
	if (!m) m = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? "";
	return m
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<nav[\s\S]*?<\/nav>/gi, " ")
		.replace(/<(figure|figcaption|aside)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(
			/&#?\w+;/g,
			(c) =>
				({
					"&amp;": "&",
					"&quot;": '"',
					"&#160;": " ",
					"&nbsp;": " ",
					"&#8217;": "'",
					"&#8212;": "—",
				})[c] ?? " "
		)
		.replace(/\s+/g, " ")
		.trim();
}

function links(html: string): string[] {
	const out: string[] = [];
	for (const m of html.matchAll(/href="([^"#?]+)"/g)) {
		let u = m[1];
		if (u.startsWith("/")) u = BASE + u;
		if (!u.startsWith(BASE)) continue;
		const path = u.slice(BASE.length).replace(/\/$/, "/") || "/";
		if (EXCLUDE.test(path)) continue;
		if (!INCLUDE.test(path)) continue;
		out.push(u.split("#")[0]);
	}
	return out;
}

async function fetchPage(url: string): Promise<string | null> {
	for (let a = 0; a < 3; a++) {
		try {
			return (await scrapeWithAphrody(url, { profile: "static" })).content;
		} catch {
			// Retry below with bounded backoff.
		}
		await sleep(400);
	}
	return null;
}

const slug = (u: string) =>
	"kz-" +
	u
		.slice(BASE.length)
		.replace(/[^a-z0-9]+/gi, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 70);

async function main() {
	const visited = new Set<string>();
	const queue: string[] = SEEDS.map((s) => BASE + s);
	const docs: { id: string; name: string; url: string; chars: number; markdown: string }[] = [];

	while (queue.length && visited.size < MAX) {
		const batch = queue.splice(0, CONC).filter((u) => !visited.has(u));
		if (batch.length === 0) continue;
		for (const u of batch) visited.add(u);
		await Promise.all(
			batch.map(async (url) => {
				const html = await fetchPage(url);
				if (!html) return;
				for (const l of links(html)) if (!visited.has(l) && !queue.includes(l)) queue.push(l);
				const text = extractText(html);
				if (text.length < 400) return;
				const title =
					html
						.match(/<title>([^<]*)<\/title>/i)?.[1]
						?.replace(/\s*[|–-]\s*Kanzenshuu.*$/i, "")
						.trim() ?? url;
				docs.push({
					id: slug(url),
					name: `${title} (kanzenshuu)`,
					url,
					chars: text.length,
					markdown: `# ${title}\n\n${text.slice(0, 14000)}`,
				});
			})
		);
		if (visited.size % 30 === 0)
			console.log(`[KZ] visités ${visited.size}, retenus ${docs.length}, queue ${queue.length}`);
		await sleep(150);
	}

	await Bun.write(OUT, JSON.stringify({ generatedAt: "kz", count: docs.length, docs }, null, 0));
	console.log(`[KZ] TERMINÉ — ${docs.length} docs (sur ${visited.size} visités) → ${OUT}`);
}

main().catch((e) => {
	console.error("[KZ] erreur:", e);
	process.exit(1);
});
