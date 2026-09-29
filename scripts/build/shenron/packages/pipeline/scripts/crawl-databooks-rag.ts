/**
 * crawl-databooks-rag.ts — Crawl de sources AUTORITAIRES de databooks/guidebooks
 * Dragon Ball traduits vers un shard RAG : Kanzentai (archives Wayback, trad.
 * Daizenshuu/Kai/Gold Warrior/interviews), forums Neoseeker (guidebooks traduits),
 * fredcrash (artbooks), Toei officiel DBGT.
 *
 * Extraction par domaine (wayback toolbar retiré, posts forum, contenu principal).
 * Neoseeker : suit la pagination du thread. Sortie : shard-databooks.json.
 *
 * Usage : bun scripts/crawl-databooks-rag.ts
 */
import { join } from "node:path";
import { scrapeWithAphrody } from "./lib/aphrody-web-scrape.ts";

const OUT = join(import.meta.dir, "..", "data", "rag", "shard-databooks.json");
const CONC = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENT: Record<string, string> = {
	"&amp;": "&",
	"&quot;": '"',
	"&#160;": " ",
	"&nbsp;": " ",
	"&#8217;": "'",
	"&#8212;": "—",
	"&#39;": "'",
	"&lt;": "<",
	"&gt;": ">",
	"&#8230;": "…",
};
function detag(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#?\w+;/g, (c) => ENT[c] ?? " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Extraction selon le domaine. */
function extract(url: string, html: string): string {
	if (url.includes("web.archive.org")) {
		// Retire la toolbar Wayback puis prend le body.
		let h = html.replace(/<div id="wm-ipp[\s\S]*?<\/div>\s*(<!--\s*END WAYBACK[\s\S]*?-->)?/i, " ");
		h = h.replace(/<!--\s*BEGIN WAYBACK[\s\S]*?END WAYBACK TOOLBAR INSERT\s*-->/i, " ");
		const body = h.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? h;
		return detag(body);
	}
	if (url.includes("neoseeker.com")) {
		// Concatène le contenu des posts du forum.
		const posts = [
			...html.matchAll(
				/<div[^>]*class="[^"]*\b(?:postContent|message|post-content|content)\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div class="post)/gi
			),
		]
			.map((m) => detag(m[1]))
			.filter((t) => t.length > 80);
		if (posts.length) return posts.join("\n\n");
		// fallback : plus gros bloc texte de l'article
		const main =
			html.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
			html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
			"";
		return detag(main || html.match(/<body[\s\S]*?<\/body>/i)?.[0] || "");
	}
	// Générique : main/article/content sinon body.
	const m =
		html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
		html.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
		html.match(/<div[^>]*(?:id|class)="[^"]*content[^"]*"[^>]*>[\s\S]*?<\/div>/i)?.[0] ??
		html.match(/<body[\s\S]*?<\/body>/i)?.[0] ??
		html;
	return detag(m);
}

/** Neoseeker : URLs de pagination du thread (page 2..N). */
function neoseekerPages(url: string, html: string): string[] {
	const pages = new Set<string>();
	for (const m of html.matchAll(
		/href="(https:\/\/www\.neoseeker\.com\/forums\/88\/t\d+-[^"#?]*?(?:-\d+)?)"/g
	)) {
		if (/-\d+$/.test(m[1])) pages.add(m[1]);
	}
	return [...pages].slice(0, 12);
}

const slug = (u: string) =>
	"db-" +
	u
		.replace(/^https?:\/\//, "")
		.replace(/web\.archive\.org\/web\/\d+\//, "")
		.replace(/[^a-z0-9]+/gi, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 75);

async function fetchPage(url: string): Promise<string | null> {
	for (let a = 0; a < 3; a++) {
		try {
			return (await scrapeWithAphrody(url, { profile: "static" })).content;
		} catch {
			// Retry below with bounded backoff.
		}
		await sleep(600);
	}
	return null;
}

// ── Sources (URLs fournies) ──────────────────────────────────────────────────
const W = "https://web.archive.org/web";
const KANZENTAI = [
	`${W}/20120304001216/http://www.kanzentai.com/trans.php`,
	`${W}/20111011045832/http://kanzentai.com/trans-daiz01.php`,
	`${W}/20120216180653/http://www.kanzentai.com/trans-daiz02.php`,
	`${W}/20111011061543/http://kanzentai.com/trans-daiz04.php`,
	`${W}/20120125083354/http://www.kanzentai.com/trans-daiz06.php`,
	`${W}/20120110040130/http://www.kanzentai.com/trans-daiz07.php`,
	`${W}/20111011061618/http://kanzentai.com/trans-kai_dbook01.php`,
	`${W}/20111011061430/http://kanzentai.com/trans-kai_dbook02.php`,
	`${W}/20120127011423/http://www.kanzentai.com/trans-gold_warrior.php`,
	`${W}/20111011061435/http://kanzentai.com/trans-kai_dbook01.php?m=01&id=interview`,
	`${W}/20111011061614/http://kanzentai.com/trans-kai_dbook02.php?m=01&id=interview`,
	`${W}/20111011061548/http://kanzentai.com/trans-gold_warrior.php?m=01&id=interview1`,
	`${W}/20111011045828/http://kanzentai.com/trans-gold_warrior.php?m=02&id=interview2`,
	`${W}/20111011061642/http://kanzentai.com/trans-gold_warrior.php?m=03&id=interview3`,
	`${W}/20111011061510/http://kanzentai.com/trans-daiz04.php?m=11&id=shenron_times`,
	`${W}/20111011045855/http://kanzentai.com/trans-daiz01.php?m=04&id=shenron_times`,
	`${W}/20111011061608/http://kanzentai.com/trans-daiz02.php?m=11&id=shenron_times`,
	`${W}/20111011042611/http://kanzentai.com/trans-bc_r02.php?m=01&id=interview`,
	`${W}/20111011061444/http://kanzentai.com/trans-daiz01.php?m=02&id=interview`,
	`${W}/20111011061454/http://kanzentai.com/trans-daiz02.php?m=10&id=interview`,
	`${W}/20120328072955/http://www.kanzentai.com/trans-daiz04.php?m=10&id=interview`,
];
const NEOSEEKER = [
	"t2433621-chozenshuu-volumes-translated",
	"t2435436-akira-toriyama-world-1990-dragon-ball-parts-translated",
	"t2444252-dragon-ball-daima-blu-ray-standard-edition-booklet-translated",
	"t2413614-dragon-ball-film-animation-comics-translated",
	"t2418249-dragon-ball-forever-guidebook-translated",
	"t2418929-dragon-ball-extreme-battle-collection-rounds-translated",
	"t2417053-dragon-ball-tv-anime-guide-son-goku-densetsu-translated",
	"t2418960-toei-anime-fair-pamphlets-translated",
	"t2415368-jump-anime-library-1-dragon-ball-movie-12-translated",
	"t2415637-jump-anime-collection-3-dragon-ball-movie-13-translated",
	"t2420656-dragon-ball-super-exciting-guide-translated",
	"t2421303-dragon-book-movies-translated",
	"t2422558-daizenshuu-volumes-translated",
	"t2424996-2008-ova-bog-rof-dbs-broly-super-hero-anime-comics-translated",
	"t2427454-dragon-ball-battle-of-gods-theatrical-program-booklet-translated",
	"t2427840-dragon-ball-battle-of-gods-official-movie-guide-translated",
	"t2428182-resurrection-pamphlet-translated",
	"t2428555-dragon-ball-volume-translated",
	"t2428650-dragon-ball-super-broly-pamphlet-translated",
	"t2428774-dragon-ball-super-broly-theatrical-program-super-edition-translated",
	"t2429889-gt-perfect-files-translated",
].map((t) => `https://www.neoseeker.com/forums/88/${t}/`);
const OTHER = [
	"https://fredcrash.com/db/index.php?p=artbooks&artbook=Art_Book_Dragon_Ball_Divers",
	"https://www.toei-anim.co.jp/tv/dragongt/dbgt/index.html",
];

/** Résout une URL vers son snapshot Wayback le plus proche (Neoseeker bloque le direct). */
async function resolveWayback(url: string): Promise<string | null> {
	try {
		const archiveUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
		const result = await scrapeWithAphrody(archiveUrl, { profile: "http" });
		const d = JSON.parse(result.content) as { archived_snapshots?: { closest?: { url?: string } } };
		return d?.archived_snapshots?.closest?.url ?? null;
	} catch {
		return null;
	}
}

async function main() {
	// Neoseeker bloque le direct → on passe par Wayback.
	console.log("[DATABOOKS] résolution Neoseeker via Wayback…");
	const neoWayback: string[] = [];
	for (const u of NEOSEEKER) {
		const w = await resolveWayback(u);
		if (w) neoWayback.push(w);
		await sleep(200);
	}
	console.log(`  ${neoWayback.length}/${NEOSEEKER.length} threads Neoseeker archivés trouvés`);
	const seeds = [...KANZENTAI, ...neoWayback, ...OTHER];
	const visited = new Set<string>();
	const queue = [...seeds];
	const docs: { id: string; name: string; url: string; chars: number; markdown: string }[] = [];

	while (queue.length) {
		const batch = queue.splice(0, CONC).filter((u) => !visited.has(u));
		if (!batch.length) continue;
		for (const u of batch) visited.add(u);
		await Promise.all(
			batch.map(async (url) => {
				const html = await fetchPage(url);
				if (!html) {
					console.warn(`✗ ${url.slice(-50)}`);
					return;
				}
				if (url.includes("neoseeker.com"))
					for (const p of neoseekerPages(url, html))
						if (!visited.has(p) && !queue.includes(p)) queue.push(p);
				const text = extract(url, html);
				if (text.length < 500) return;
				const title =
					html
						.match(/<title>([^<]*)<\/title>/i)?.[1]
						?.replace(/\s*[-|–].*$/, "")
						.trim() || url;
				docs.push({
					id: slug(url),
					name: `${title} (databook)`,
					url,
					chars: text.length,
					markdown: `# ${title}\n\n${text.slice(0, 15000)}`,
				});
				console.log(`✓ ${docs.length} ${title.slice(0, 50)} (${text.length}c)`);
			})
		);
		await sleep(250);
	}
	await Bun.write(
		OUT,
		JSON.stringify({ generatedAt: "databooks", count: docs.length, docs }, null, 0)
	);
	console.log(`[DATABOOKS] TERMINÉ — ${docs.length} docs → ${OUT}`);
}

main().catch((e) => {
	console.error("[DATABOOKS]", e);
	process.exit(1);
});
