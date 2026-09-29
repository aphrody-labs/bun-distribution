#!/usr/bin/env bun
/**
 * Exact deduplication of image assets by SHA-256 of the full content.
 *
 * A duplicate is NEVER deleted: it is replaced, at the same path, by a hard link
 * to the canonical file (same inode, same bytes) so every existing URL keeps
 * answering. Both files are re-hashed right before linking. The rewrite is
 * atomic (link to a temp name, then rename over the duplicate).
 *
 * A reversible manifest is written to `apps/shenron/bot/data/assets-dedup-<date>.json`
 * (`path → canonical, sha256, size`). To undo: copy the canonical over the path
 * (identical bytes) — `--undo=<manifest>` does exactly that.
 *
 * DB references (15 image columns + `db_databooks.pages[].image` +
 * `db_manga_chapters.pages[]`) pointing at a duplicate are rewritten to the
 * canonical DB path; counts are printed before/after.
 *
 * Canonical choice per group: the file referenced by the database, else the one
 * under a tracked/curated root (`apps/shenron/bot/assets` > `apps/shenron/site/public/wiki` >
 * `apps/shenron/bot/public/db`), else the shortest path.
 *
 * DRY-RUN BY DEFAULT.
 *   bun apps/shenron/bot/scripts/assets-dedup.ts            # simulate
 *   bun apps/shenron/bot/scripts/assets-dedup.ts --apply    # link + rewrite DB
 *   bun apps/shenron/bot/scripts/assets-dedup.ts --undo=apps/shenron/bot/data/assets-dedup-2026-09-12.json
 */
import { copyFileSync, linkSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { dbPathToDisk, dbPathToUrlPath, diskToDbPath, hashFile, normalizeDbPath } from "@shenron/images";
import { arretSiGel } from "../../site/scripts/_databooks-base";

const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.find((a) => a.startsWith("--undo="))?.slice(7);
/** Replay only the DB rewrite + URL check from an existing manifest (links already done). */
const REWRITE_FROM = process.argv.find((a) => a.startsWith("--rewrite-from="))?.slice(15);
const RACINE = join(import.meta.dir, "..", "..", "..");
const ROOTS = { bot: join(RACINE, "apps/shenron/bot"), site: join(RACINE, "apps/shenron/site") };
const CACHE = join(ROOTS.bot, "data/cache/assets-inventory.jsonl");
const DATE = new Date().toISOString().slice(0, 10);
const BOT_URL = process.env.BOT_URL ?? "http://127.0.0.1:5006";

const IMAGE_COLUMNS: [string, string][] = [
	["db_characters", "image"], ["db_characters", "portrait_xv2"], ["db_character_variants", "image"],
	["db_character_arcs", "appearance_image"], ["db_planets", "image"], ["db_techniques", "image"],
	["db_transformations", "image"], ["db_sagas", "image"], ["db_movies", "poster"], ["db_episodes", "image"],
	["db_databooks", "cover"], ["db_manga_volumes", "cover"], ["db_manga_chapters", "cover"],
	["db_games", "cover"], ["db_news", "image"],
];

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(ROOTS.site, ".env")).text().catch(() => "");
	const v = texte.split("\n").findLast((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
	if (!v) throw new Error("DATABASE_URL introuvable");
	return v;
}

interface Entry { path: string; size: number; sha256: string }
interface ManifestEntry { path: string; canonical: string; sha256: string; size: number; dbPath: string | null; canonicalDbPath: string | null }

if (UNDO) {
	const m = JSON.parse(await Bun.file(UNDO).text()) as { entries: ManifestEntry[] };
	let n = 0;
	for (const e of m.entries) {
		const a = statSync(e.path, { throwIfNoEntry: false });
		const b = statSync(e.canonical, { throwIfNoEntry: false });
		if (!a || !b || a.ino !== b.ino) continue;
		copyFileSync(e.canonical, `${e.path}.undo-tmp`);
		renameSync(`${e.path}.undo-tmp`, e.path);
		n++;
	}
	console.log(`${n} fichier(s) redevenus indépendants (les références DB restent sur le canonique : mêmes octets).`);
	process.exit(0);
}

// Ce programme réécrit notamment `db_databooks.pages[].image`. Le contrôle est
// placé avant la résolution de DATABASE_URL et la création du client postgres.
arretSiGel("assets-dedup");

const manifestFromFile: ManifestEntry[] | null = REWRITE_FROM ? (JSON.parse(await Bun.file(REWRITE_FROM).text()) as { entries: ManifestEntry[] }).entries : null;
// ── 1. Groups from the inventory ──────────────────────────────────────────────
const entries: Entry[] = (await Bun.file(CACHE).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const bySha = new Map<string, Entry[]>();
for (const e of entries) if (e.sha256) bySha.set(e.sha256, [...(bySha.get(e.sha256) ?? []), e]);
const groups = [...bySha.values()].filter((g) => g.length > 1);

// ── 2. Which DB paths are referenced (to pick canonicals and rewrite) ────────
const sql = postgres(await urlBase(), { max: 2, prepare: false });
const referenced = new Map<string, number>(); // normalized db path → refs
for (const [t, c] of IMAGE_COLUMNS) {
	const rows = (await sql.unsafe(`select ${c} as p, count(*)::int as n from bot.${t} where ${c} is not null and ${c} <> '' group by 1`)) as unknown as { p: string; n: number }[];
	for (const r of rows) referenced.set(normalizeDbPath(r.p), (referenced.get(normalizeDbPath(r.p)) ?? 0) + r.n);
}
for (const r of (await sql`select p->>'image' as p, count(*)::int as n from bot.db_databooks d, jsonb_array_elements(d.pages) p where p->>'image' is not null group by 1`) as unknown as { p: string; n: number }[])
	referenced.set(normalizeDbPath(r.p), (referenced.get(normalizeDbPath(r.p)) ?? 0) + r.n);
for (const r of (await sql`select p #>> '{}' as p, count(*)::int as n from bot.db_manga_chapters c, jsonb_array_elements(c.pages) p group by 1`) as unknown as { p: string; n: number }[])
	referenced.set(normalizeDbPath(r.p), (referenced.get(normalizeDbPath(r.p)) ?? 0) + r.n);

const rootRank = (p: string) => (p.startsWith(join(ROOTS.bot, "assets")) ? 0 : p.startsWith(join(ROOTS.site, "public/wiki")) ? 1 : 2);
const refsOf = (disk: string) => { const d = diskToDbPath(disk, ROOTS); return d ? (referenced.get(normalizeDbPath(d)) ?? 0) : 0; };

const manifest: ManifestEntry[] = [];
let alreadyLinked = 0, recoverable = 0;
for (const g of manifestFromFile ? [] : groups) {
	const sorted = [...g].toSorted((a, b) => refsOf(b.path) - refsOf(a.path) || rootRank(a.path) - rootRank(b.path) || a.path.length - b.path.length);
	const canonical = sorted[0]!;
	for (const dup of sorted.slice(1)) {
		const sa = statSync(canonical.path), sb = statSync(dup.path);
		if (sa.ino === sb.ino && sa.dev === sb.dev) { alreadyLinked++; continue; }
		recoverable += dup.size;
		manifest.push({ path: dup.path, canonical: canonical.path, sha256: dup.sha256, size: dup.size, dbPath: diskToDbPath(dup.path, ROOTS), canonicalDbPath: diskToDbPath(canonical.path, ROOTS) });
	}
}
console.log(`${groups.length} groupe(s) sha256, ${manifest.length} doublon(s) à lier (${alreadyLinked} déjà liés), ${(recoverable / 1e6).toFixed(1)} MB récupérables`);
const refsBefore = manifest.reduce((a, m) => a + (m.dbPath ? (referenced.get(normalizeDbPath(m.dbPath)) ?? 0) : 0), 0);
console.log(`Références DB vers un doublon : ${refsBefore}`);

if (!APPLY && !manifestFromFile) { await sql.end(); console.log("(simulation : --apply pour lier et réécrire)"); process.exit(0); }

// ── 3. Link (re-hash both first) ──────────────────────────────────────────────
let linked = 0, skipped = 0, freed = 0;
const done: ManifestEntry[] = [];
for (const m of manifestFromFile ? [] : manifest) {
	const [h1, h2] = await Promise.all([hashFile(m.canonical), hashFile(m.path)]);
	if (h1 !== m.sha256 || h2 !== m.sha256) { skipped++; console.warn(`  ! empreinte changée, ignoré : ${m.path}`); continue; }
	const tmp = `${m.path}.dedup-tmp`;
	try { unlinkSync(tmp); } catch {}
	linkSync(m.canonical, tmp);
	renameSync(tmp, m.path);
	if (statSync(m.path).ino !== statSync(m.canonical).ino) throw new Error(`inode mismatch after link: ${m.path}`);
	linked++; freed += m.size; done.push(m);
}
if (manifestFromFile) done.push(...manifestFromFile);
// Never overwrite an earlier manifest: it is the only record of what was linked.
let manifestPath = join(ROOTS.bot, "data", `assets-dedup-${DATE}.json`);
if (!manifestFromFile) {
	for (let i = 2; await Bun.file(manifestPath).exists(); i++) manifestPath = join(ROOTS.bot, "data", `assets-dedup-${DATE}-${i}.json`);
}
if (!manifestFromFile && linked > 0) await Bun.write(manifestPath, JSON.stringify({ date: DATE, method: "hardlink", linked, freedBytes: freed, entries: done }, null, 1));
if (!manifestFromFile) console.log(`${linked} lié(s), ${skipped} ignoré(s), ${(freed / 1e6).toFixed(1)} MB libérés → ${manifestPath.replace(RACINE + "/", "")}`);

// ── 4. Rewrite DB references (duplicate db path → canonical db path) ─────────
const rewrite = new Map<string, string>();
for (const m of done) if (m.dbPath && m.canonicalDbPath && m.dbPath !== m.canonicalDbPath) rewrite.set(normalizeDbPath(m.dbPath), m.canonicalDbPath);
let updated = 0;
const touchedUrls = new Set<string>();
for (const [t, c] of IMAGE_COLUMNS) {
	// Some tables have no `id` (db_character_arcs): match on the value itself.
	const rows = (await sql.unsafe(`select distinct ${c} as p from bot.${t} where ${c} is not null and ${c} <> ''`)) as unknown as { p: string }[];
	for (const r of rows) {
		const to = rewrite.get(normalizeDbPath(r.p));
		if (!to) continue;
		const res = await sql.unsafe(`update bot.${t} set ${c} = $1 where ${c} = $2`, [to, r.p]);
		updated += res.count; touchedUrls.add(to);
	}
}
for (const r of (await sql`select id, pages from bot.db_databooks where pages is not null`) as unknown as { id: number; pages: { image?: string }[] }[]) {
	let changed = false;
	const pages = r.pages.map((p) => { const to = p.image ? rewrite.get(normalizeDbPath(p.image)) : undefined; if (to) { changed = true; touchedUrls.add(to); updated++; return { ...p, image: to }; } return p; });
	if (changed) await sql`update bot.db_databooks set pages = ${sql.json(pages as never)} where id = ${r.id}`;
}
for (const r of (await sql`select id, pages from bot.db_manga_chapters where pages is not null`) as unknown as { id: number; pages: string[] }[]) {
	let changed = false;
	const pages = r.pages.map((p) => { const to = rewrite.get(normalizeDbPath(p)); if (to) { changed = true; touchedUrls.add(to); updated++; return to; } return p; });
	if (changed) await sql`update bot.db_manga_chapters set pages = ${sql.json(pages as never)} where id = ${r.id}`;
}
let refsAfter = 0;
for (const [t, c] of IMAGE_COLUMNS) {
	const rows = (await sql.unsafe(`select ${c} as p from bot.${t} where ${c} is not null and ${c} <> ''`)) as unknown as { p: string }[];
	for (const r of rows) if (rewrite.has(normalizeDbPath(r.p))) refsAfter++;
}
await sql.end();
console.log(`Références réécrites : ${updated} (restantes vers un doublon dans les colonnes texte : ${refsAfter})`);

// ── 5. Every rewritten URL still answers ──────────────────────────────────────
let ok = 0, ko = 0;
for (const to of touchedUrls) {
	const disk = dbPathToDisk(to, ROOTS);
	const urlPath = dbPathToUrlPath(to);
	if (!disk || !statSync(disk, { throwIfNoEntry: false })) { ko++; console.warn(`  ✗ fichier absent : ${to}`); continue; }
	if (!urlPath) { ok++; continue; }
	try {
		const res = await fetch(`${BOT_URL}${urlPath}`, { method: "HEAD" });
		if (res.ok) ok++; else { ko++; console.warn(`  ✗ HEAD ${res.status} ${urlPath}`); }
	} catch { ok++; /* bot unreachable: file existence already verified */ }
}
console.log(`URLs vérifiées : ${ok} OK, ${ko} KO sur ${touchedUrls.size}`);
