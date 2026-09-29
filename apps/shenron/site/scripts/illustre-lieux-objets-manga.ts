#!/usr/bin/env bun
/**
 * Illustrate wiki locations and items with panels cropped from the official manga.
 *
 * Driven by `apps/shenron/site/data/illustrations-lieux-objets.json`: one entry per entity,
 * each naming the exact source page (series, chapter, page, CDN URL) and the crop
 * box in source pixels. Every crop was chosen by eye; this script only replays it.
 *
 * For each entry:
 *   1. download the source page, crop it with sharp (WebP q86, max 1200 px wide);
 *   2. with `--appliquer`: upload it to the asset host with `scp`, then check the
 *      remote SHA-256 and the public CDN URL (HTTP 200, same content-length);
 *   3. in ONE transaction: register a `bot.db_assets` row, set the entity `image`
 *      only while it is still empty, and journal a `public.wiki_revisions` row.
 *
 * Dry-run by default. Idempotent: an entity whose image is already set, or whose
 * crop SHA-256 is already registered, is skipped.
 *
 * Usage (repo root):
 *   bun --env-file=.env apps/shenron/site/scripts/illustre-lieux-objets-manga.ts
 *   bun --env-file=.env apps/shenron/site/scripts/illustre-lieux-objets-manga.ts --appliquer
 *   bun --env-file=.env apps/shenron/site/scripts/illustre-lieux-objets-manga.ts --appliquer --ids 17,18
 */
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { CDN_ORIGIN, SITE_URL } from "../src/lib/config";

type Table = "db_locations" | "db_items";

interface Entry {
	table: Table;
	id: number;
	slug: string;
	/** Path relative to the wiki asset root, e.g. `locations/<slug>.webp`. */
	file: string;
	source: { series: "DBFC" | "DBS"; chapter: number; page: number; url: string };
	crop: { left: number; top: number; width: number; height: number };
	attribution: string;
	note?: string;
}

interface Rendered {
	entry: Entry;
	data: Uint8Array;
	sha256: string;
	width: number;
	height: number;
}

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--appliquer");
const idsIndex = ARGS.indexOf("--ids");
const ONLY_IDS = idsIndex === -1 ? null : new Set((ARGS[idsIndex + 1] ?? "").split(",").map((v) => `${v.trim()}`));

const MANIFEST = join(import.meta.dir, "..", "data", "illustrations-lieux-objets.json");
const WORK_DIR = join(tmpdir(), "shenron-illustrations-manga");
const SSH_HOST = process.env.ILLUSTRATIONS_SSH_HOST ?? "vps";
const REMOTE_ROOT = process.env.ILLUSTRATIONS_REMOTE_ROOT ?? "/srv/shenron/shared/site/wiki";
const CDN_ROOT = process.env.ILLUSTRATIONS_CDN_ROOT ?? `${CDN_ORIGIN}/assets/wiki`;
const MAX_WIDTH = 1200;
const WEBP_QUALITY = 86;
const EDITOR_ID = "shenron-illustrations-manga";
const EDITOR_NAME = "Shenron — illustrations issues du manga";
const LICENSE = "FAIR-USE-EDITORIAL";
const SOURCES = {
	DBFC: { id: "manga-dbfc", name: "Dragon Ball Full Color (Akira Toriyama / Shueisha)" },
	DBS: { id: "manga-dbs", name: "Dragon Ball Super (Akira Toriyama, Toyotarō / Shueisha)" },
} as const;
const ENTITY_TYPE: Record<Table, string> = { db_locations: "location", db_items: "item" };

/** Runs a command, fails loudly on a non-zero exit, returns stdout. */
async function run(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`${cmd[0]} exited ${code}: ${err.trim()}`);
	return out;
}

/** curl rather than fetch: the CDN edge answers curl's TLS fingerprint reliably. */
async function download(url: string, target: string): Promise<void> {
	if (await Bun.file(target).exists()) return;
	for (let attempt = 1; attempt <= 4; attempt++) {
		try {
			await run(["curl", "-sS", "-f", "-m", "180", "-o", `${target}.part`, url]);
			await run(["mv", `${target}.part`, target]);
			return;
		} catch (error) {
			if (attempt === 4) throw error;
			await Bun.sleep(1000 * attempt);
		}
	}
}

async function render(entry: Entry): Promise<Rendered> {
	const page = join(WORK_DIR, `${entry.source.series}-ch${entry.source.chapter}-${String(entry.source.page).padStart(3, "0")}.src`);
	await download(entry.source.url, page);
	const meta = await sharp(page).metadata();
	const { left, top, width, height } = entry.crop;
	if (!meta.width || !meta.height || left + width > meta.width || top + height > meta.height) {
		throw new Error(`${entry.slug}: crop outside the ${meta.width}x${meta.height} source page`);
	}
	const { data, info } = await sharp(page)
		.extract(entry.crop)
		.resize({ width: MAX_WIDTH, withoutEnlargement: true })
		.webp({ quality: WEBP_QUALITY })
		.toBuffer({ resolveWithObject: true });
	const bytes = new Uint8Array(data);
	await Bun.write(join(WORK_DIR, entry.file.replace("/", "-")), bytes);
	return {
		entry,
		data: bytes,
		sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
		width: info.width,
		height: info.height,
	};
}

/** Uploads the crop and proves the asset host and the CDN serve exactly these bytes. */
async function publish(rendered: Rendered): Promise<void> {
	const { entry, data, sha256 } = rendered;
	const local = join(WORK_DIR, entry.file.replace("/", "-"));
	const remote = `${REMOTE_ROOT}/${entry.file}`;
	const remoteDir = remote.slice(0, remote.lastIndexOf("/"));
	await run(["ssh", "-o", "BatchMode=yes", SSH_HOST, `install -d -m 775 '${remoteDir}'`]);
	await run(["scp", "-q", "-o", "BatchMode=yes", local, `${SSH_HOST}:${remote}`]);
	await run(["ssh", "-o", "BatchMode=yes", SSH_HOST, `chmod 664 '${remote}'`]);
	const remoteSha = (await run(["ssh", "-o", "BatchMode=yes", SSH_HOST, `sha256sum '${remote}'`])).split(/\s+/)[0];
	if (remoteSha !== sha256) throw new Error(`${entry.slug}: remote sha256 ${remoteSha} ≠ local ${sha256}`);

	const url = `${CDN_ROOT}/${entry.file}`;
	const headers = await run(["curl", "-sS", "-I", "-m", "60", url]);
	const status = /^HTTP\/[\d.]+\s+(\d+)/m.exec(headers)?.[1];
	const length = /^content-length:\s*(\d+)/im.exec(headers)?.[1];
	if (status !== "200") throw new Error(`${entry.slug}: ${url} answered HTTP ${status}`);
	if (length && Number(length) !== data.length) {
		throw new Error(`${entry.slug}: ${url} content-length ${length} ≠ ${data.length}`);
	}
	const served = await run(["curl", "-sS", "-f", "-m", "120", url, "-o", `${local}.served`]).then(async () =>
		new Bun.CryptoHasher("sha256").update(await Bun.file(`${local}.served`).arrayBuffer()).digest("hex")
	);
	if (served !== sha256) throw new Error(`${entry.slug}: CDN served sha256 ${served} ≠ local ${sha256}`);
}

function isConnectionError(error: unknown): boolean {
	const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
	return /ECONNREFUSED|ECONNRESET|CONNECT_TIMEOUT|CONNECTION_CLOSED|CONNECTION_ENDED|ETIMEDOUT|Failed to connect|write CONNECTION/i.test(text);
}

/** The production tunnel drops connections: retry the whole unit of work, up to 6 times. */
async function withRetry<T>(label: string, work: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await work();
		} catch (error) {
			if (attempt >= 6 || !isConnectionError(error)) throw error;
			const wait = 500 * 2 ** attempt;
			console.warn(`  … ${label}: connexion perdue (${(error as Error).message}), nouvel essai dans ${wait} ms`);
			await Bun.sleep(wait);
		}
	}
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
	console.error("✗ DATABASE_URL absent — lancer avec `bun --env-file=.env`.");
	process.exit(1);
}

const manifest = ((await Bun.file(MANIFEST).json()) as Entry[]).filter((e) => !ONLY_IDS || ONLY_IDS.has(`${e.id}`));
await mkdir(WORK_DIR, { recursive: true });
const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 20, idle_timeout: 5 });

let applied = 0;
let skipped = 0;
let failed = 0;
try {
	if (APPLY) {
		await withRetry("sources", async () => {
			for (const source of Object.values(SOURCES)) {
				await sql`
					insert into bot.db_sources (id, name, url, license_key)
					values (${source.id}, ${source.name}, ${`${SITE_URL}/wiki/manga`}, ${LICENSE})
					on conflict (id) do nothing
				`;
			}
		});
	}

	for (const entry of manifest) {
		const label = `${entry.table}#${entry.id} ${entry.slug}`;
		try {
			const rendered = await render(entry);
			const image = `./assets/wiki/${entry.file}`;
			const state = await withRetry(label, async () => {
				const [row] = await sql`select id, slug, image from ${sql(`bot`)}.${sql(entry.table)} where id = ${entry.id}`;
				const [asset] = await sql`select id from bot.db_assets where sha256 = ${rendered.sha256} limit 1`;
				return { row, asset };
			});
			if (!state.row) throw new Error("entité introuvable");
			if (state.row.slug !== entry.slug) throw new Error(`slug en base « ${state.row.slug} » ≠ manifeste`);
			const summary = `${rendered.width}x${rendered.height} ${rendered.data.length} o sha256 ${rendered.sha256.slice(0, 16)}…`;
			if (state.row.image?.trim() || state.asset) {
				skipped++;
				console.log(`= ${label} — déjà illustré (${state.row.image ?? `asset ${state.asset?.id}`})`);
				continue;
			}
			if (!APPLY) {
				console.log(`~ ${label} ← ${entry.source.url} ${JSON.stringify(entry.crop)} → ${image} (${summary})`);
				continue;
			}

			await publish(rendered);
			const outcome = await withRetry(label, () =>
				sql.begin(async (tx) => {
					const [before] = await tx`select * from ${tx(`bot`)}.${tx(entry.table)} where id = ${entry.id} for update`;
					if (!before || before.image?.trim()) return "skip" as const;
					const [already] = await tx`select id from bot.db_assets where sha256 = ${rendered.sha256} limit 1`;
					if (already) return "skip" as const;
					await tx`lock table bot.db_assets in share row exclusive mode`;
					const [{ next }] = await tx`select coalesce(max(id), 0) + 1 as next from bot.db_assets`;
					await tx`
						insert into bot.db_assets (id, path, source_id, source_url, license_key, attribution, sha256,
						                           mime_type, bytes, width, height, entity_type, entity_id, role, created_at)
						values (${Number(next)}, ${entry.file}, ${SOURCES[entry.source.series].id}, ${entry.source.url},
						        ${LICENSE}, ${entry.attribution}, ${rendered.sha256}, ${"image/webp"},
						        ${rendered.data.length}, ${rendered.width}, ${rendered.height},
						        ${ENTITY_TYPE[entry.table]}, ${entry.id}, ${"thumbnail"}, ${Math.floor(Date.now() / 1000)})
					`;
					const [after] = await tx`
						update ${tx(`bot`)}.${tx(entry.table)} set image = ${image}
						where id = ${entry.id} and coalesce(trim(image), '') = ''
						returning *
					`;
					if (!after) throw new Error("image posée entre-temps par un autre agent");
					await tx`
						insert into public.wiki_revisions (id, "tableName", "rowId", action, label, before, after, "editorId", "editorName")
						values (${crypto.randomUUID()}, ${entry.table}, ${String(entry.id)}, ${"update"},
						        ${`${before.name} — illustration issue du manga (${entry.attribution})`},
						        ${tx.json(before as postgres.JSONValue)}, ${tx.json(after as postgres.JSONValue)},
						        ${EDITOR_ID}, ${EDITOR_NAME})
					`;
					return "done" as const;
				})
			);
			if (outcome === "skip") {
				skipped++;
				console.log(`= ${label} — déjà illustré au moment d'écrire`);
			} else {
				applied++;
				console.log(`✓ ${label} → ${CDN_ROOT}/${entry.file} (${summary})`);
			}
		} catch (error) {
			failed++;
			console.error(`✗ ${label} — ${(error as Error).message}`);
		}
	}
} finally {
	await sql.end({ timeout: 5 });
}

console.log(
	`\n${manifest.length} entrée(s) · ${applied} appliquée(s) · ${skipped} déjà faite(s) · ${failed} échec(s)${APPLY ? "" : " — simulation (relancer avec --appliquer)"}`
);
if (failed) process.exit(1);
