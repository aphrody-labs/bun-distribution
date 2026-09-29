/** First-party Toei episode importer. Usage: sudo -u postgres bun apps/shenron/bot/scripts/ingest-toei-episode-synopses.ts --apply --local */
import postgres from "postgres";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const LOCAL = process.argv.includes("--local");
const SERIES = {
	DB: ["dragon", 1, 153],
	DBZ: ["dragonz", 1, 291],
	// Toei's catalogue preserves the Japanese continuous numbering. Its pages
	// 99..159 are the 61 Japanese broadcasts of the Final Chapters, not the
	// separate 2009 Kai run (whose old pages are no longer exposed here).
	DBZ_KAI_FINAL: ["dragon_kai", 99, 159],
	DBS: ["dragon_super", 1, 131],
} as const;
type Series = keyof typeof SERIES;
type ToeiEpisode = { series: Series; number: number; titleJa: string; synopsisJa: string; airDate: number | null; credits: string | null; image: string | null; url: string };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (v: string) => v.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, "> ").replace(/\s+/g, " ").trim();
const match = (html: string, re: RegExp) => html.match(re)?.[1] ?? null;

function parseEpisode(series: Series, url: string, html: string): ToeiEpisode | null {
	const heading = match(html, /<h1 class="story_caption_title">([\s\S]*?)<\/h1>/i);
	const number = heading?.match(/第\s*(\d+)\s*話/)?.[1];
	const titleJa = heading ? decode(heading).replace(/^第\s*\d+\s*話\s*/, "") : "";
	const synopsis = match(html, /<div class="text_details_inner">\s*([\s\S]*?)\s*<\/div>/i);
	const date = html.match(/(\d{4})\/(\d{2})\/(\d{2})\s*<span[^>]*>放送/i);
	const image = match(html, /<img name="story1" src="([^"]+)"/i);
	const credits = match(html, /<div id="story_caption">[\s\S]*?<p>\s*[\s\S]*?<br\s*\/?>([\s\S]*?)<\/p>/i);
	if (!number || !titleJa || !synopsis) return null;
	return { series, number: Number(number), titleJa, synopsisJa: decode(synopsis), airDate: date ? Math.floor(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) / 1000) : null, credits: credits ? decode(credits) : null, image: image ? new URL(image, url).href : null, url };
}
async function fetchText(url: string): Promise<string> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const response = await fetch(url, { headers: { "user-agent": "Shenron-DBFR/1.0 (+https://dragonballfr.com; official catalogue sync)" }, signal: AbortSignal.timeout(20_000) });
		if (response.ok) return response.text();
		if (response.status < 500 && response.status !== 429) throw new Error(`HTTP ${response.status}`);
		await sleep(1_000 * (attempt + 1));
	}
	throw new Error("unavailable after retries");
}
async function catalogue(series: Series, source: readonly [string, number, number]): Promise<ToeiEpisode[]> {
	const [slug, first, last] = source;
	const base = `https://lineup.toei-anim.co.jp/ja/tv/${slug}/episode/`;
	const out: ToeiEpisode[] = [];
	// Toei loads catalogue pages after the first 30 entries through an AJAX pager.
	// Episode URLs themselves are stable and contiguous, so enumerate the published
	// range explicitly rather than silently stopping at the initial HTML fragment.
	for (let number = first; number <= last; number++) {
		const id = String(number);
		const url = new URL(`${id}/`, base).href;
		try { const ep = parseEpisode(series, url, await fetchText(url)); if (ep) out.push(ep); else console.warn(`[${series}#${id}] page non reconnue`); } catch (e) { console.warn(`[${series}#${id}] ${(e as Error).message}`); }
		await sleep(350);
	}
	return out;
}
const sql = LOCAL ? postgres({ host: "/var/run/postgresql", database: "shenron_site", prepare: false }) : postgres(process.env.DATABASE_URL ?? "", { prepare: false });
const kaiFinal = JSON.parse(readFileSync(new URL("../data/kai-final-correspondance.json", import.meta.url), "utf8")) as { entrees: Array<{ id: number; jp: number }> };
const kaiFinalByJapaneseEpisode = new Map(kaiFinal.entrees.map((entry) => [entry.jp, entry.id]));
try {
	if (!LOCAL && !process.env.DATABASE_URL) throw new Error("DATABASE_URL requis (ou --local sous l'utilisateur postgres).");
	if (APPLY) { await sql`ALTER TABLE bot.db_episodes ADD COLUMN IF NOT EXISTS official_source_url text`; await sql`ALTER TABLE bot.db_episodes ADD COLUMN IF NOT EXISTS official_metadata jsonb`; }
	let parsed = 0, updated = 0, unmatched = 0;
	for (const [series, source] of Object.entries(SERIES) as [Series, readonly [string, number, number]][]) {
		const episodes = await catalogue(series, source); parsed += episodes.length; console.log(`${series}: ${episodes.length} fiches Toei lues.`);
		for (const ep of episodes) {
			const kaiId = ep.series === "DBZ_KAI_FINAL" ? kaiFinalByJapaneseEpisode.get(ep.number) : null;
			const found = kaiId
				? await sql`SELECT id FROM bot.db_episodes WHERE id = ${kaiId} AND series = 'DBZ_KAI_FINAL' LIMIT 1`
				: await sql`SELECT id FROM bot.db_episodes WHERE series = ${ep.series} AND number_in_series = ${ep.number} LIMIT 1`;
			if (!found.length) { unmatched++; continue; }
			if (!APPLY) continue;
			await sql`UPDATE bot.db_episodes SET title_ja = ${ep.titleJa}, synopsis = ${ep.synopsisJa}, air_date = COALESCE(${ep.airDate}, air_date), official_source_url = ${ep.url}, official_metadata = ${sql.json({ provider: "Toei Animation", credits: ep.credits, image: ep.image, fetchedAt: new Date().toISOString() })} WHERE id = ${found[0]!.id}`;
			updated++;
		}
	}
	console.log(`${APPLY ? "✓" : "Simulation :"} ${parsed} fiches lues, ${updated} épisodes mis à jour, ${unmatched} sans correspondance.`);
} finally { await sql.end(); }
