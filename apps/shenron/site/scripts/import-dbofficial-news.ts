/**
 * Publishes short, attributed pointers to recent Dragon Ball Official news.
 *
 * The DBFR post never mirrors the upstream article: it stores its title, the
 * public OG summary, its image and a canonical link back to the official page.
 * This makes the local journal useful while respecting the publisher's text.
 *
 * Usage (local PostgreSQL):
 *   sudo -u postgres bun apps/shenron/site/scripts/import-dbofficial-news.ts --local
 */
import postgres from "postgres";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_URL } from "../src/lib/config";

const LOCAL = process.argv.includes("--local");
const LIMIT = Math.min(Math.max(Number(process.env.LIMIT ?? 12), 1), 30);
const ORIGIN = "https://dragon-ball-official.com";
async function databaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const envPath = join(import.meta.dir, "..", ".env");
	const content = await readFile(envPath, "utf8").catch(() => "");
	const value = content
		.split("\n")
		.filter((line) => line.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^['"]|['"]$/g, "");
	if (value) return value;
	throw new Error("DATABASE_URL requis, ou --local sous l'utilisateur postgres.");
}

const sql = LOCAL
	? postgres({ host: "/var/run/postgresql", database: "shenron_site", prepare: false })
	: postgres(await databaseUrl(), { prepare: false });

const decode = (value: string) => value
	.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
	.replace(/&lt;/gi, "<").replace(/&gt;/gi, "> ").replace(/\s+/g, " ").trim();
const meta = (html: string, property: string) => {
	const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ?? "");
};
const textFrom = (html: string) => decode((html.match(/<div class="text-area">([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ?? "").replace(/<[^>]+>/g, " "));
const slugFrom = (url: string) => `officiel-${url.match(/\/(\d+_\d+)\.html$/)?.[1] ?? crypto.randomUUID()}`;

async function fetchText(url: string) {
	const response = await fetch(url, { headers: { "user-agent": `Shenron-DBFR/1.0 (+${SITE_URL}; official-news attribution)` }, signal: AbortSignal.timeout(20_000) });
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.text();
}

try {
	const admins = await sql`SELECT id FROM public."User" WHERE "roleAdmin" = true ORDER BY "createdAt" ASC LIMIT 1`;
	if (!admins.length) throw new Error("Aucun compte administrateur disponible pour créditer l'import officiel.");
	const feedPath = new URL("../../../data/crawled_db/db_official_news.json", import.meta.url).pathname;
	let urls: string[] = [];
	if (existsSync(feedPath)) {
		const feed = JSON.parse(await Bun.file(feedPath).text()) as Array<{ url?: string }>;
		urls = feed.map((item) => item.url).filter((url): url is string => Boolean(url && /^https:\/\/dragon-ball-official\.com\/news\/\d+_\d+\.html$/.test(url))).slice(0, LIMIT);
	}
	if (!urls.length) {
		const home = await fetchText(`${ORIGIN}/`);
		urls = [...new Set([...home.matchAll(/href=["'](?:https:\/\/dragon-ball-official\.com)?(\/news\/\d+_\d+\.html)["']/g)].map((m) => new URL(m[1]!, ORIGIN).href))].slice(0, LIMIT);
	}
	let created = 0, refreshed = 0, failed = 0;
	for (const url of urls) {
		try {
			const html = await fetchText(url);
			const originalTitle = meta(html, "og:title").replace(/\s*[｜|]\s*【公式】ドラゴンボールオフィシャルサイト\s*$/u, "").trim();
			const excerpt = meta(html, "og:description") || textFrom(html).slice(0, 320);
			const image = meta(html, "og:image") || null;
			const date = html.match(/<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})["']/i)?.[1];
			if (!originalTitle || !excerpt) throw new Error("métadonnées éditoriales absentes");
			const body = `Actualité officielle publiée par Dragon Ball Official.\n\nTitre original : ${originalTitle}\n\n[Lire l’article original sur Dragon Ball Official](${url})`;
			const existing = await sql`SELECT id FROM public."Post" WHERE "canonicalUrl" = ${url} LIMIT 1`;
			if (existing.length) {
				await sql`UPDATE public."Post" SET title = ${originalTitle}, excerpt = ${excerpt.slice(0, 320)}, body = ${body}, cover = ${image}, "coverAlt" = ${originalTitle}, "ogImage" = ${image}, "updatedAt" = NOW() WHERE id = ${existing[0]!.id}`;
				refreshed++;
			} else {
				await sql`INSERT INTO public."Post" (id, slug, title, excerpt, body, cover, "coverAlt", tags, published, status, "publishedAt", "ogImage", "canonicalUrl", "noindex", "readingMinutes", "wordCount", "agentName", "authorId") VALUES (${crypto.randomUUID().replaceAll("-", "")}, ${slugFrom(url)}, ${originalTitle}, ${excerpt.slice(0, 320)}, ${body}, ${image}, ${originalTitle}, ${sql.json(["Actualité officielle", "Dragon Ball Official"])}, true, 'published', ${date ? new Date(`${date}T00:00:00Z`) : new Date()}, ${image}, ${url}, true, 1, ${body.split(/\s+/).length}, 'Shenron · import officiel', ${admins[0]!.id})`;
				created++;
			}
		} catch (error) { failed++; console.warn(`${url}: ${(error as Error).message}`); }
	}
	console.log(`✓ Dragon Ball Official : ${created} actualités créées, ${refreshed} actualisées, ${failed} échecs.`);
} finally { await sql.end(); }
