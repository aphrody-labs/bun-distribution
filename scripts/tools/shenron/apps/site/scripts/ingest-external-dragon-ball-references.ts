/** Stores supplied, non-canonical Dragon Ball references separately from canon. */
import postgres from "postgres";
import { createHash } from "node:crypto";
import { decodeHtmlEntities } from "../src/lib/text/html-entities";
import { SITE_URL } from "../src/lib/config";

const LOCAL = process.argv.includes("--local");
const sql = LOCAL ? postgres({ host: "/var/run/postgresql", database: "shenron_site", prepare: false }) : postgres(process.env.DATABASE_URL ?? "", { prepare: false });
const sources = [
	{ kind: "archive", url: "https://archive.org/details/drslump/023+-+Arale%27s+Date+and+Bye-Bye+Super+Power.avi" },
	{ kind: "wayback", url: "https://web.archive.org/web/20240413025745/https://inlifeweb.com/reports/report_350.html" },
	{ kind: "publisher", url: "https://www.caramel.co.jp/about/dragonball/" },
	{ kind: "encyclopedia", url: "https://ja.wikipedia.org/wiki/%E9%B3%A5%E5%B1%B1%E6%98%8E" },
	{ kind: "statistics", url: "https://www.jajanken.net/sakuhins/QvL0By28NV" },
] as const;
/** HTML → plain text: tags dropped first, then one level of references decoded, so `&lt;b&gt;` stays literal text. */
const clean = (html: string) => decodeHtmlEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "), { preserveUrls: true }).replace(/\s+/g, " ").trim();
async function retrieve(source: (typeof sources)[number]) {
	try {
		const res = await fetch(source.url, { headers: { "user-agent": `Shenron-DBFR/1.0 (+${SITE_URL}; source registry)` }, signal: AbortSignal.timeout(25_000) });
		const html = (await res.text()).slice(0, 250_000);
		const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || source.url;
		return { ...source, status: res.status, title, excerpt: clean(html).slice(0, 8_000), hash: createHash("sha256").update(html).digest("hex") };
	} catch (error) { return { ...source, status: 0, title: source.url, excerpt: (error as Error).message, hash: createHash("sha256").update(source.url).digest("hex") }; }
}
if (!LOCAL && !process.env.DATABASE_URL) throw new Error("DATABASE_URL requis, ou --local sous postgres.");
try {
	await sql`CREATE TABLE IF NOT EXISTS public.external_source_records (url text PRIMARY KEY, kind text NOT NULL, title text NOT NULL, excerpt text NOT NULL, http_status integer NOT NULL, content_hash text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(), canonical_eligible boolean NOT NULL DEFAULT false, search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, ''))) STORED)`;
	await sql`ALTER TABLE public.external_source_records ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, ''))) STORED`;
	await sql`CREATE INDEX IF NOT EXISTS external_source_records_search_vector_idx ON public.external_source_records USING gin (search_vector)`;
	await sql`CREATE INDEX IF NOT EXISTS external_source_records_kind_fetched_idx ON public.external_source_records (kind, fetched_at DESC)`;
	const records = await Promise.all(sources.map(retrieve));
	for (const record of records) await sql`INSERT INTO public.external_source_records (url, kind, title, excerpt, http_status, content_hash, fetched_at, canonical_eligible) VALUES (${record.url}, ${record.kind}, ${record.title}, ${record.excerpt}, ${record.status}, ${record.hash}, now(), false) ON CONFLICT (url) DO UPDATE SET kind = excluded.kind, title = excluded.title, excerpt = excluded.excerpt, http_status = excluded.http_status, content_hash = excluded.content_hash, fetched_at = now()`;
	console.log(records.map((r) => `${r.kind}: HTTP ${r.status}`).join("\n"));
} finally { await sql.end(); }
