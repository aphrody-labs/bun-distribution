#!/usr/bin/env bun
/**
 * Fills the empty French synopses of the wiki's episodes and films, and the
 * empty `arc_id` of episodes whose arc is certain.
 *
 * Writes to PostgreSQL `bot.*` (the wiki's source of truth) and records one
 * `public.wiki_revisions` row per changed line, like `depose-wiki.ts`, so every
 * write can be reverted from `/admin/wiki/history`. Never writes the bot's
 * SQLite (the reverse-sync would overwrite it).
 *
 * DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 * Only EMPTY fields are filled: a non-empty `synopsis_fr` or a set `arc_id`
 * is never overwritten (the guard is repeated in the UPDATE itself).
 *
 * Commands:
 *
 *   status
 *       Empty counts per series (episodes, films, arc_id).
 *
 *   sources [--cache <dir>]
 *       Reads the raw scrape cache (default ~/.shenron-build-tmp/scrape/episodes)
 *       and writes `<cache>/sources/<SERIES>.json` (+ `MOVIES.json`): for each
 *       row whose `synopsis_fr` is empty, the facts to write from — Kanzenshuu
 *       episode guide synopsis, English Wikipedia summary, manga chapters
 *       covered. Pairing is by series + episode number, never by title.
 *
 *   deposit --drafts <file.json|dir> [--apply]
 *       Deposits drafted synopses. Draft format:
 *         [{ "series": "DB", "number": 12, "synopsis_fr": "…", "sources": ["kanzenshuu", "wikipedia-en"] },
 *          { "movie": "dead-zone", "synopsis_fr": "…", "sources": [...] }]
 *       Each text is rejected if it is not 2 to 4 sentences, is too short/long,
 *       carries unsourced wording (« probablement », « sans doute », « inconnu »…),
 *       mentions Fandom, or reuses a run of 8 words from the existing
 *       machine-translated `synopsis` column (no verbatim copy).
 *
 *   arcs [--apply]
 *       Sets `arc_id` on episodes from the ARC_RANGES table below, only where
 *       `arc_id` is NULL and the episode lies inside the arc's saga range; then
 *       propagates DBZ arcs to the DBZ_KAI / DBZ_KAI_FINAL rows whose adapted
 *       DBZ span sits entirely inside one arc.
 *
 * Scrape cache layout (produced with bxc + curl, see docs in the report):
 *   kz/<db|dbz|gt|super|daima>/<NNN>.html   Kanzenshuu episode guide pages
 *   kz/movie/<slug>.html                    Kanzenshuu movie pages
 *   wp/en-List_of_Dragon_Ball*_episodes.json `bxc wiki page --json`
 *   wp/films/<title>.md                     `bxc wiki md` of film articles
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const APPLY = flag("apply");
const CACHE = opt("cache", join(homedir(), ".shenron-build-tmp/scrape/episodes"))!;
const EDITOR_ID = "agent";
const EDITOR_NAME = "Script fill-episode-synopses (Kanzenshuu + Wikipédia, rédaction originale)";

/** Wording that betrays an unsourced text — same rule as depose-wiki.ts. */
const FORBIDDEN =
	/\b(probablement|sans doute|vraisemblablement|on suppose|il semblerait|peut-être|inconnue?s?|fandom)\b/i;

// ---------------------------------------------------------------------------
// Arc ranges. Only ranges whose boundaries are attested by a source:
//  - Kanzenshuu episode guide arc pages (/episode/<series>/<arc>/), which list
//    the exact episodes of each arc;
//  - French Wikipedia « Liste des épisodes » arc tables (« Répartition des arcs »),
//    kept only where the arc label matches the site's arc and no other source
//    contradicts it (disputed edge episodes are left out);
//  - DBZ_KAI rows already carrying an arc_id, propagated to the DBZ episodes
//    that the Kai row declares it adapts (« [Épisodes X~Y de Dragon Ball Z] »),
//    excluding episodes shared by two Kai rows of different arcs.
// A saga split into several arcs whose boundaries no source gives is left NULL.
// ---------------------------------------------------------------------------
type ArcRange = { series: string; from: number; to: number; arcId: number; source: string };
const ARC_RANGES: ArcRange[] = [
	{ series: "DB", from: 14, to: 18, arcId: 25, source: "fr.wikipedia « Répartition des arcs » (Entraînement chez Kamé Sennin)" },
	{ series: "DB", from: 19, to: 28, arcId: 26, source: "fr.wikipedia « Répartition des arcs » + kanzenshuu.com/episode arc page 21st-budokai 14-28" },
	{ series: "DB", from: 69, to: 78, arcId: 27, source: "kanzenshuu.com/episode arc page uranai-baba 69-78 + fr.wikipedia « Répartition des arcs »" },
	{ series: "DB", from: 84, to: 101, arcId: 28, source: "kanzenshuu.com/episode arc page 22nd-budokai 84-101 + fr.wikipedia « Répartition des arcs »" },
	{ series: "DB", from: 102, to: 122, arcId: 29, source: "kanzenshuu.com/episode arc page demon-king-piccolo 102-122 + fr.wikipedia « Répartition des arcs »" },
	{ series: "DB", from: 123, to: 131, arcId: 30, source: "kanzenshuu.com/episode arc page heavenly-training 123-132 ∩ fr.wikipedia « Répartition des arcs » 123-131" },
	{ series: "DB", from: 133, to: 146, arcId: 31, source: "kanzenshuu.com/episode arc page 23rd-budokai 133-148 ∩ fr.wikipedia « Répartition des arcs » 132-146" },
	{ series: "DBZ", from: 1, to: 6, arcId: 5, source: "DBZ_KAI arc_id propagated through « [Épisodes X~Y de Dragon Ball Z] » + fr.wikipedia « Répartition des arcs » (Arc Raditz 1-6)" },
	{ series: "DBZ", from: 7, to: 20, arcId: 32, source: "fr.wikipedia « Répartition des arcs » (Arc Entraînement 7-20) + DBZ_KAI arc_id propagated through « [Épisodes X~Y de Dragon Ball Z] »" },
	{ series: "DBZ", from: 22, to: 35, arcId: 6, source: "fr.wikipedia « Répartition des arcs » (Arc Nappa et Vegeta 21-35) ∩ DBZ_KAI arc_id propagated through « [Épisodes X~Y de Dragon Ball Z] »" },
	{ series: "DBZ", from: 37, to: 44, arcId: 36, source: "fr.wikipedia « Répartition des arcs » (Arc Voyage pour Namek 36-44) ∩ DBZ_KAI arc_id propagated through « [Épisodes X~Y de Dragon Ball Z] »" },
	{ series: "DBZ", from: 50, to: 59, arcId: 7, source: "DBZ_KAI arc_id propagated through « [Épisodes X~Y de Dragon Ball Z] » (Kai 23-27) within fr.wikipedia « Répartition des arcs » 45-60" },
	{ series: "DBZ", from: 61, to: 74, arcId: 8, source: "fr.wikipedia « Répartition des arcs » (Arc Commando Ginyu 61-74) + kanzenshuu.com/episode arc page namek 36-74" },
	{ series: "DBZ", from: 153, to: 159, arcId: 37, source: "fr.wikipedia « Répartition des arcs » (Arc Cell 2e forme 152-159)" },
	{ series: "DBZ", from: 160, to: 167, arcId: 38, source: "fr.wikipedia « Répartition des arcs » (Arc Cell forme parfaite 160-167)" },
	{ series: "DBZ", from: 176, to: 194, arcId: 12, source: "fr.wikipedia « Répartition des arcs » (Arc Cell Game 176-194) + kanzenshuu.com/episode arc page cell 140-194" },
	{ series: "DBZ", from: 195, to: 199, arcId: 45, source: "kanzenshuu.com/episode arc page afterlife-tournament 195-199 + fr.wikipedia « Répartition des arcs »" },
	{ series: "DBZ", from: 200, to: 205, arcId: 46, source: "fr.wikipedia « Répartition des arcs » (Arc Great Saiyaman 200-205)" },
	{ series: "DBZ", from: 206, to: 219, arcId: 47, source: "fr.wikipedia « Répartition des arcs » (Arc 25e Tenkaichi Budokai 206-219)" },
	{ series: "DBZ", from: 220, to: 230, arcId: 48, source: "fr.wikipedia « Répartition des arcs » (Arc Babidi 220-231, ep. 231 = awakening left out)" },
	{ series: "DBZ", from: 232, to: 254, arcId: 15, source: "fr.wikipedia « Répartition des arcs » (Arc Gros Boo 232-254)" },
	{ series: "DBZ", from: 255, to: 276, arcId: 16, source: "fr.wikipedia « Répartition des arcs » (Arc Boo 2e forme 255-276)" },
	{ series: "DBZ", from: 277, to: 286, arcId: 17, source: "fr.wikipedia « Répartition des arcs » (Arc Boo original 277-286)" },
	{ series: "DBGT", from: 41, to: 47, arcId: 56, source: "fr.wikipedia « Répartition des arcs » (Saga Super C-17 41-47), single arc of its saga" },
	{ series: "DBS", from: 1, to: 14, arcId: 18, source: "kanzenshuu.com/episode arc page battle-of-gods 1-14 + fr.wikipedia « Répartition des arcs »" },
	{ series: "DBS", from: 15, to: 27, arcId: 19, source: "kanzenshuu.com/episode arc page resurrection-f 15-27 + fr.wikipedia « Répartition des arcs »" },
	{ series: "DBS", from: 28, to: 41, arcId: 20, source: "fr.wikipedia « Répartition des arcs » (Champa 28-41; 42-46 filler) within kanzenshuu.com/episode arc page champa 28-46" },
];

// ---------------------------------------------------------------------------
// Films: database slug -> cached sources.
// ---------------------------------------------------------------------------
const MOVIE_SOURCES: Record<string, { wikipedia?: string; kanzenshuu?: string }> = {
	"curse-blood-rubies": { wikipedia: "Dragon_Ball__Curse_of_the_Blood_Rubies", kanzenshuu: "db-01" },
	"sleeping-princess": { wikipedia: "Dragon_Ball__Sleeping_Princess_in_Devil_27s_Castle", kanzenshuu: "db-02" },
	"mystical-adventure": { wikipedia: "Dragon_Ball__Mystical_Adventure", kanzenshuu: "db-03" },
	"path-to-power": { wikipedia: "Dragon_Ball__The_Path_to_Power" },
	"dead-zone": { wikipedia: "Dragon_Ball_Z__Dead_Zone", kanzenshuu: "dbz-01" },
	"worlds-strongest": { wikipedia: "Dragon_Ball_Z__The_World_27s_Strongest", kanzenshuu: "dbz-02" },
	"tree-of-might": { wikipedia: "Dragon_Ball_Z__The_Tree_of_Might", kanzenshuu: "dbz-03" },
	"lord-slug": { wikipedia: "Dragon_Ball_Z__Lord_Slug", kanzenshuu: "dbz-04" },
	"coolers-revenge": { wikipedia: "Dragon_Ball_Z__Cooler_27s_Revenge", kanzenshuu: "dbz-05" },
	"return-of-cooler": { wikipedia: "Dragon_Ball_Z__The_Return_of_Cooler", kanzenshuu: "dbz-06" },
	"super-android-13": { wikipedia: "Dragon_Ball_Z__Super_Android_13_", kanzenshuu: "dbz-07" },
	"broly-legendary-ssj": { wikipedia: "Dragon_Ball_Z__Broly__E2_80_93_The_Legendary_Super_Saiyan" },
	"bojack-unbound": { wikipedia: "Dragon_Ball_Z__Bojack_Unbound" },
	"broly-second-coming": { wikipedia: "Dragon_Ball_Z__Broly__E2_80_93_Second_Coming" },
	"bio-broly": { wikipedia: "Dragon_Ball_Z__Bio_Broly" },
	"fusion-reborn": { wikipedia: "Dragon_Ball_Z__Fusion_Reborn" },
	"wrath-of-dragon": { wikipedia: "Dragon_Ball_Z__Wrath_of_the_Dragon" },
	"dragon-ball-z-special-1-tatta-hitori-no-saishuu-kessen": {
		wikipedia: "Dragon_Ball_Z__Bardock__E2_80_93_The_Father_of_Goku",
	},
	"history-of-trunks": { wikipedia: "Dragon_Ball_Z__The_History_of_Trunks" },
	"dragon-ball-z-movie-14-kami-to-kami": {
		wikipedia: "Dragon_Ball_Z__Battle_of_Gods",
		kanzenshuu: "battle-of-gods",
	},
	"dragon-ball-z-movie-15-fukkatsu-no-f": {
		wikipedia: "Dragon_Ball_Z__Resurrection__27F_27",
		kanzenshuu: "resurrection-f",
	},
	"dragon-ball-super-broly": { wikipedia: "Dragon_Ball_Super__Broly", kanzenshuu: "dragon-ball-super-broly" },
	"dragon-ball-super-super-hero": { wikipedia: "Dragon_Ball_Super__Super_Hero", kanzenshuu: "super-hero" },
	"gt-a-heros-legacy": { wikipedia: "Dragon_Ball_GT__A_Hero_27s_Legacy" },
	"plan-to-eradicate-saiyans": { wikipedia: "Plan_to_Eradicate_the_Saiyans", kanzenshuu: "dbz-ptets" },
	"plan-to-eradicate-super-saiyans": {
		wikipedia: "Plan_to_Eradicate_the_Saiyans",
		kanzenshuu: "db-ptetss",
	},
	"yo-son-goku-return": { wikipedia: "Dragon_Ball__Yo__Son_Goku_and_His_Friends_Return__", kanzenshuu: "db-jsat" },
	"episode-of-bardock": { wikipedia: "Dragon_Ball__Episode_of_Bardock", kanzenshuu: "episode-of-bardock" },
};

/** Kanzenshuu directory and file-number width per database series. */
const KZ: Record<string, { dir: string; width: number }> = {
	DB: { dir: "db", width: 3 },
	DBZ: { dir: "dbz", width: 3 },
	DBGT: { dir: "gt", width: 2 },
	DBS: { dir: "super", width: 3 },
	DB_DAIMA: { dir: "daima", width: 3 },
};
/** English Wikipedia episode list per series (bxc wiki page --json). */
const WP_EN: Record<string, string> = {
	DB: "en-List_of_Dragon_Ball_episodes.json",
	DBGT: "en-List_of_Dragon_Ball_GT_episodes.json",
	DBS: "en-List_of_Dragon_Ball_Super_episodes.json",
	DB_DAIMA: "en-Dragon_Ball_Daima.json",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function databaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const text = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// The file carries TWO DATABASE_URL lines (old Neon first): take the LAST one.
	const line = text
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1);
	const value = line
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!value) {
		console.error("✗ DATABASE_URL not found.");
		process.exit(1);
	}
	return value;
}

const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#039;": "'",
	"&nbsp;": " ",
	"&hellip;": "…",
};
function htmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<\/p>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&[a-z]+;|&#039;/g, (e) => ENTITIES[e] ?? " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
}

/** Synopsis and corresponding chapters of a cached Kanzenshuu page. */
async function readKanzenshuu(path: string): Promise<{ synopsis: string; corresponding: string } | null> {
	if (!existsSync(path)) return null;
	const html = await Bun.file(path).text();
	// Some pages title the block `<h1 class="summary">` and follow it with a long
	// scene-by-scene `<div id="summary">`: stop at whichever comes first.
	const syn =
		/<h1[^>]*>(?:Episode |Movie |Special )?Synopsis<\/h1>([\s\S]*?)(?:<div id="summary"|<h2 class="next-eps"|<h1)/i.exec(
			html
		);
	const corr = /<strong>Corresponding:<\/strong><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
	const synopsis = syn ? htmlToText(syn[1]!) : "";
	if (!synopsis) return null;
	return { synopsis, corresponding: corr ? htmlToText(corr[1]!) : "" };
}

type WikiTable = { titre?: string; entetes: string[]; lignes: string[][] };

/** Episode number -> English summary, from a `bxc wiki page --json` episode list. */
async function readWikipediaEpisodes(file: string): Promise<Map<number, string>> {
	const out = new Map<number, string>();
	const path = join(CACHE, "wp", file);
	if (!existsSync(path)) return out;
	const page = (await Bun.file(path).json()) as { tableaux: WikiTable[] };
	for (const table of page.tableaux) {
		const rows = table.lignes;
		for (let i = 0; i + 1 < rows.length; i++) {
			const head = String(rows[i]![0] ?? "").trim();
			if (!/^\d+$/.test(head)) continue;
			const next = rows[i + 1]!;
			const cells = new Set(next.map((c) => String(c)));
			// Summary rows span every column: bxc expands the colspan into identical cells.
			if (cells.size !== 1) continue;
			const summary = String(next[0]).trim();
			if (summary.length < 80 || /^\d+$/.test(summary)) continue;
			const n = Number(head);
			if (!out.has(n)) out.set(n, summary);
		}
	}
	return out;
}

/** "Plot" section of a cached `bxc wiki md` film article. */
async function readFilmPlot(name: string): Promise<string> {
	const path = join(CACHE, "wp", "films", `${name}.md`);
	if (!existsSync(path)) return "";
	const md = await Bun.file(path).text();
	const m = /^#{1,3}\s*(?:Plot|Synopsis|Story)[^\n]*\n([\s\S]*?)(?=^#{1,3}\s)/im.exec(md);
	return m
		? m[1]!
				.replace(/\[(\d+|citation needed|[a-z])\]/gi, "")
				.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
				.trim()
		: "";
}

const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

function sentenceCount(text: string): number {
	// Sentence ends: . ! ? … possibly doubled (« !! »), followed by space/end, not inside "M. " / "C-17."
	const cleaned = text.replace(/\b(M|Mr|Dr|St|Cie)\./g, "$1");
	return cleaned.split(/(?<=[.!?…])["»\s]*\s+(?=[A-ZÀ-ÖØ-Þ«"])/u).filter((s) => s.trim().length > 0)
		.length;
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean);

/** Longest shared run of words between two texts (verbatim-copy detector). */
function longestSharedRun(a: string, b: string): number {
	const wa = norm(a);
	const wb = norm(b);
	if (!wa.length || !wb.length) return 0;
	let best = 0;
	let prev = Array.from({ length: wb.length + 1 }, () => 0);
	for (let i = 1; i <= wa.length; i++) {
		const cur = Array.from({ length: wb.length + 1 }, () => 0);
		for (let j = 1; j <= wb.length; j++) {
			if (wa[i - 1] === wb[j - 1]) {
				cur[j] = prev[j - 1]! + 1;
				if (cur[j]! > best) best = cur[j]!;
			}
		}
		prev = cur;
	}
	return best;
}

function validate(text: string, previous: string | null): string | null {
	const t = text.trim();
	if (t.length < 120) return `too short (${t.length})`;
	if (t.length > 1000) return `too long (${t.length})`;
	const n = sentenceCount(t);
	if (n < 2 || n > 4) return `${n} sentence(s), expected 2 to 4`;
	const bad = FORBIDDEN.exec(t);
	if (bad) return `unsourced wording « ${bad[0]} »`;
	if (/https?:|\[\d+\]|\*\*/.test(t)) return "markup or link in text";
	if (previous) {
		const run = longestSharedRun(t, previous);
		if (run >= 8) return `shares ${run} consecutive words with the existing synopsis`;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const sql = postgres(await databaseUrl(), { max: 2, prepare: false });
const jsonb = (value: unknown) => sql.json(value as Parameters<typeof sql.json>[0]);

type EpisodeRow = {
	id: string;
	series: string;
	number_in_series: string | null;
	title: string | null;
	title_ja: string | null;
	synopsis: string | null;
	synopsis_fr: string | null;
	arc_id: string | null;
};

async function status() {
	const eps = await sql`
		SELECT series, count(*)::int AS total,
			count(*) FILTER (WHERE coalesce(synopsis_fr, '') = '')::int AS empty_synopsis,
			count(*) FILTER (WHERE arc_id IS NULL)::int AS empty_arc
		FROM bot.db_episodes WHERE visible GROUP BY series ORDER BY series`;
	console.table(eps);
	const movies = await sql`
		SELECT count(*)::int AS total, count(*) FILTER (WHERE coalesce(synopsis_fr, '') = '')::int AS empty_synopsis
		FROM bot.db_movies WHERE visible`;
	console.table(movies);
}

async function sources() {
	const outDir = join(CACHE, "sources");
	await Bun.$`mkdir -p ${outDir}`.quiet();
	const rows = await sql<EpisodeRow[]>`
		SELECT id, series, number_in_series, title, title_ja, synopsis, synopsis_fr, arc_id
		FROM bot.db_episodes
		WHERE visible AND coalesce(synopsis_fr, '') = ''
		ORDER BY series, number_in_series`;
	const bySeries = new Map<string, EpisodeRow[]>();
	for (const r of rows) bySeries.set(r.series, [...(bySeries.get(r.series) ?? []), r]);

	for (const [series, list] of bySeries) {
		const kz = KZ[series];
		const wp = WP_EN[series] ? await readWikipediaEpisodes(WP_EN[series]!) : new Map<number, string>();
		const out = [];
		let withSource = 0;
		for (const r of list) {
			const n = Number(r.number_in_series);
			const kzPath = kz ? join(CACHE, "kz", kz.dir, `${String(n).padStart(kz.width, "0")}.html`) : "";
			const k = kz ? await readKanzenshuu(kzPath) : null;
			const w = wp.get(n) ?? "";
			if (k || w) withSource++;
			out.push({
				series,
				number: n,
				title_fr: r.title,
				title_ja: r.title_ja,
				kanzenshuu: k?.synopsis ?? null,
				corresponding: k?.corresponding ?? null,
				wikipedia_en: w ? w.slice(0, 2500) : null,
			});
		}
		await Bun.write(join(outDir, `${series}.json`), JSON.stringify(out, null, "\t"));
		console.log(`${series}: ${list.length} empty, ${withSource} with at least one source`);
	}

	const movies = await sql<{ id: string; slug: string; title: string; series: string | null }[]>`
		SELECT id, slug, title, series FROM bot.db_movies
		WHERE visible AND coalesce(synopsis_fr, '') = '' ORDER BY release_date`;
	const outMovies = [];
	for (const m of movies) {
		const src = MOVIE_SOURCES[m.slug] ?? {};
		const k = src.kanzenshuu ? await readKanzenshuu(join(CACHE, "kz", "movie", `${src.kanzenshuu}.html`)) : null;
		const plot = src.wikipedia ? await readFilmPlot(src.wikipedia) : "";
		outMovies.push({
			movie: m.slug,
			title_fr: m.title,
			series: m.series,
			kanzenshuu: k?.synopsis ?? null,
			wikipedia_en: plot ? plot.slice(0, 6000) : null,
		});
	}
	await Bun.write(join(outDir, "MOVIES.json"), JSON.stringify(outMovies, null, "\t"));
	console.log(
		`MOVIES: ${movies.length} empty, ${outMovies.filter((m) => m.kanzenshuu || m.wikipedia_en).length} with at least one source`
	);
}

type Draft = { series?: string; number?: number; movie?: string; synopsis_fr: string; sources?: string[] };

async function readDrafts(target: string): Promise<Draft[]> {
	const files = statSync(target).isDirectory()
		? readdirSync(target)
				.filter((f) => f.endsWith(".json"))
				.toSorted()
				.map((f) => join(target, f))
		: [target];
	const all: Draft[] = [];
	for (const f of files) {
		const parsed = (await Bun.file(f).json()) as Draft[];
		if (!Array.isArray(parsed)) throw new Error(`${f}: expected a JSON array`);
		all.push(...parsed);
	}
	return all;
}

async function deposit() {
	const target = opt("drafts");
	if (!target) throw new Error("--drafts <file|dir> is required");
	const drafts = await readDrafts(target);
	const counts = new Map<string, { ok: number; skipped: number; rejected: number }>();
	const bump = (key: string, field: "ok" | "skipped" | "rejected") => {
		const c = counts.get(key) ?? { ok: 0, skipped: 0, rejected: 0 };
		c[field]++;
		counts.set(key, c);
	};

	for (const d of drafts) {
		const text = (d.synopsis_fr ?? "").trim().replace(/\s+/g, " ");
		if (!text) continue;
		const isMovie = Boolean(d.movie);
		const key = isMovie ? "MOVIES" : String(d.series);
		const table = isMovie ? "db_movies" : "db_episodes";
		const [row] = isMovie
			? await sql<{ id: string; label: string; synopsis: string | null; synopsis_fr: string | null }[]>`
				SELECT id, title AS label, synopsis, synopsis_fr FROM bot.db_movies WHERE slug = ${d.movie!} AND visible`
			: await sql<{ id: string; label: string; synopsis: string | null; synopsis_fr: string | null }[]>`
				SELECT id, title AS label, synopsis, synopsis_fr FROM bot.db_episodes
				WHERE series = ${d.series!} AND number_in_series = ${d.number!} AND visible`;
		const ref = isMovie ? `movie ${d.movie}` : `${d.series} #${d.number}`;
		if (!row) {
			console.log(`✗ ${ref}: row not found`);
			bump(key, "rejected");
			continue;
		}
		if ((row.synopsis_fr ?? "").trim()) {
			bump(key, "skipped");
			continue;
		}
		const fault = validate(text, row.synopsis);
		if (fault) {
			console.log(`✗ ${ref}: ${fault}`);
			bump(key, "rejected");
			continue;
		}
		if (!APPLY) {
			bump(key, "ok");
			continue;
		}
		const written = await sql.begin(async (tx) => {
			const updated = await tx.unsafe(
				`UPDATE bot.${table} SET synopsis_fr = $1 WHERE id = $2 AND coalesce(synopsis_fr, '') = '' RETURNING id`,
				[text, row.id]
			);
			if (updated.length === 0) return false;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: table,
				rowId: String(row.id),
				action: "update",
				label: row.label ?? `${table}#${row.id}`,
				before: jsonb({ synopsis_fr: row.synopsis_fr ?? null }),
				after: jsonb({ synopsis_fr: text, sources: d.sources ?? [] }),
				editorId: EDITOR_ID,
				editorName: EDITOR_NAME,
			})}`;
			return true;
		});
		bump(key, written ? "ok" : "skipped");
	}
	console.log(APPLY ? "\nWritten:" : "\nDry run (re-run with --apply):");
	console.table(Object.fromEntries(counts));
}

async function arcs() {
	const arcRows = await sql<
		{ id: string; name: string; episode_series: string | null; episode_start: string | null; episode_end: string | null }[]
	>`
		SELECT a.id, a.name, s.episode_series, s.episode_start, s.episode_end
		FROM bot.db_arcs a LEFT JOIN bot.db_sagas s ON s.id = a.saga_id
		WHERE a.visible`;
	const arcById = new Map(arcRows.map((a) => [Number(a.id), a]));
	const counts = new Map<string, { set: number; already: number; rejected: number }>();
	const bump = (k: string, f: "set" | "already" | "rejected", by = 1) => {
		const c = counts.get(k) ?? { set: 0, already: 0, rejected: 0 };
		c[f] += by;
		counts.set(k, c);
	};

	for (const range of ARC_RANGES) {
		const arc = arcById.get(range.arcId);
		if (!arc) throw new Error(`arc #${range.arcId} missing or hidden`);
		// Consistency guard: the range must sit inside the saga's episode range.
		const inSaga =
			arc.episode_series === range.series &&
			Number(arc.episode_start) <= range.from &&
			range.to <= Number(arc.episode_end);
		if (!inSaga) {
			console.log(`✗ ${range.series} ${range.from}-${range.to} → arc #${range.arcId}: outside its saga range`);
			bump(range.series, "rejected", range.to - range.from + 1);
			continue;
		}
		const rows = await sql<{ id: string; title: string | null; arc_id: string | null }[]>`
			SELECT id, title, arc_id FROM bot.db_episodes
			WHERE series = ${range.series} AND visible
				AND number_in_series BETWEEN ${range.from} AND ${range.to}
			ORDER BY number_in_series`;
		for (const r of rows) {
			if (r.arc_id !== null) {
				bump(range.series, Number(r.arc_id) === range.arcId ? "already" : "rejected");
				if (Number(r.arc_id) !== range.arcId)
					console.log(`! ${range.series} episode id ${r.id} already on arc #${r.arc_id}, kept`);
				continue;
			}
			if (!APPLY) {
				bump(range.series, "set");
				continue;
			}
			const done = await sql.begin(async (tx) => {
				const u = await tx`UPDATE bot.db_episodes SET arc_id = ${range.arcId}
					WHERE id = ${r.id} AND arc_id IS NULL RETURNING id`;
				if (u.length === 0) return false;
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: idRevision(),
					tableName: "db_episodes",
					rowId: String(r.id),
					action: "update",
					label: r.title ?? `db_episodes#${r.id}`,
					before: jsonb({ arc_id: null }),
					after: jsonb({ arc_id: range.arcId, source: range.source }),
					editorId: EDITOR_ID,
					editorName: EDITOR_NAME,
				})}`;
				return true;
			});
			bump(range.series, done ? "set" : "already");
		}
	}
	await propagateToKai(bump);
	console.log(APPLY ? "\nWritten:" : "\nDry run (re-run with --apply):");
	console.table(Object.fromEntries(counts));
}

/**
 * DBZ_KAI / DBZ_KAI_FINAL rows declare the DBZ episodes they adapt
 * (« [Épisodes 62~63 de Dragon Ball Z] »). A Kai row gets an arc only when EVERY
 * DBZ episode of that span carries the same arc (after the ranges above, which
 * in a dry run are simulated rather than read back).
 */
async function propagateToKai(bump: (k: string, f: "set" | "already" | "rejected", by?: number) => void) {
	const dbz = await sql<{ number_in_series: string; arc_id: string | null }[]>`
		SELECT number_in_series, arc_id FROM bot.db_episodes WHERE series = 'DBZ' AND visible`;
	const arcOf = new Map<number, number | null>();
	for (const r of dbz) arcOf.set(Number(r.number_in_series), r.arc_id === null ? null : Number(r.arc_id));
	for (const range of ARC_RANGES.filter((r) => r.series === "DBZ"))
		for (let n = range.from; n <= range.to; n++) if (arcOf.get(n) == null) arcOf.set(n, range.arcId);

	const kai = await sql<{ id: string; series: string; title: string | null; synopsis_fr: string | null }[]>`
		SELECT id, series, title, synopsis_fr FROM bot.db_episodes
		WHERE series IN ('DBZ_KAI', 'DBZ_KAI_FINAL') AND visible AND arc_id IS NULL
		ORDER BY series, number_in_series`;
	for (const k of kai) {
		const head = /^\s*\[[ÉE]pisodes?\s+([\d\s~-]+?)\s+de\s+"?\s*Dragon Ball Z/i.exec(k.synopsis_fr ?? "");
		if (!head) continue;
		const nums = head[1]!.split(/[~\-\s]+/).filter(Boolean).map(Number);
		const from = Math.min(...nums);
		const to = Math.max(...nums);
		if (!Number.isFinite(from) || to - from > 6) continue;
		const arcsSeen = new Set<number | null>();
		for (let n = from; n <= to; n++) arcsSeen.add(arcOf.get(n) ?? null);
		if (arcsSeen.size !== 1 || arcsSeen.has(null)) continue;
		const arcId = [...arcsSeen][0]!;
		const source = `DBZ ${from}-${to} arc_id through « [Épisodes ${head[1]!.trim()} de Dragon Ball Z] »`;
		if (!APPLY) {
			bump(k.series, "set");
			continue;
		}
		const done = await sql.begin(async (tx) => {
			const u = await tx`UPDATE bot.db_episodes SET arc_id = ${arcId} WHERE id = ${k.id} AND arc_id IS NULL RETURNING id`;
			if (u.length === 0) return false;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_episodes",
				rowId: String(k.id),
				action: "update",
				label: k.title ?? `db_episodes#${k.id}`,
				before: jsonb({ arc_id: null }),
				after: jsonb({ arc_id: arcId, source }),
				editorId: EDITOR_ID,
				editorName: EDITOR_NAME,
			})}`;
			return true;
		});
		bump(k.series, done ? "set" : "already");
	}
}

try {
	const command = args[0];
	if (command === "status") await status();
	else if (command === "sources") await sources();
	else if (command === "deposit") await deposit();
	else if (command === "arcs") await arcs();
	else {
		console.error(
			await Bun.file(import.meta.path)
				.text()
				.then((t) => t.split("*/")[0]!.replace(/^#!.*\n/, ""))
		);
		process.exitCode = 2;
	}
} catch (e) {
	console.error(`✗ ${(e as Error).message}`);
	process.exitCode = 1;
} finally {
	await sql.end();
}
