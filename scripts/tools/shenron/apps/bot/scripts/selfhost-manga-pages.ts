/**
 * selfhost-manga-pages.ts — Rapatrie les planches de scans **N&B** hotlinkées
 * (scan-vf.net / lelscanfr.com / mangadex) vers nos propres assets, puis
 * réécrit `bot.db_manga_chapters.pages` en chemins locaux.
 *
 * But : supprimer le « renvoi sur un autre site » — les planches étaient des
 * `<img src="https://www.scan-vf.net/…">` (servies par un tiers). Après ce
 * script, elles sont téléchargées sur le VPS (`assets/manga/<SERIE>/ch<id>/…`),
 * converties en WebP (sharp, q72) et servies depuis bot.dragonballfr.com.
 *
 * Idempotent : un chapitre dont les `pages` sont déjà locales (sans `http`) est
 * sauté. Garde-fou disque (stop si < 800 Mo libres). Un chapitre n'est réécrit
 * en base que si TOUTES ses planches ont été récupérées (pas de demi-chapitre).
 *
 * Env requis : DATABASE_URL (Neon).
 * Usage :
 *   env DATABASE_URL=… bun scripts/selfhost-manga-pages.ts [--series DBS] [--limit 20] [--chapter <id>] [--dry-run]
 */
import postgres from "postgres";
import sharp from "sharp";
import { mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const arg = (k: string) => {
	const i = args.indexOf(k);
	return i !== -1 ? args[i + 1] : undefined;
};
const series = arg("--series");
const onlyChapter = arg("--chapter") ? Number(arg("--chapter")) : undefined;
const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ASSETS_ROOT = join(import.meta.dir, "..", "assets");
const MIN_FREE_BYTES = 800 * 1024 * 1024;

const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Referer par hôte (anti-hotlink). */
function refererFor(u: string): string | undefined {
	try {
		const h = new URL(u).hostname;
		if (h.includes("scan-vf")) return "https://www.scan-vf.net/";
		if (h.includes("lelscanfr")) return "https://lelscanfr.com/";
		if (h.includes("mangadex")) return "https://mangadex.org/";
	} catch {
		/* ignore */
	}
	return undefined;
}

async function freeBytes(): Promise<number> {
	const s = await statfs(ASSETS_ROOT);
	return s.bavail * s.bsize;
}

const isExternal = (p: string) => /^https?:\/\//i.test(p);

type Chapter = { id: number; series: string; chapter_number: number | null; pages: string[] };

async function selfhostChapter(ch: Chapter): Promise<{ ok: boolean; pages: string[] }> {
	const relDir = `manga/${ch.series}/ch${ch.id}`;
	const absDir = join(ASSETS_ROOT, relDir);
	if (!dryRun) await mkdir(absDir, { recursive: true });

	const local: string[] = [];
	for (let i = 0; i < ch.pages.length; i++) {
		const src = ch.pages[i];
		const pageNum = String(i + 1).padStart(3, "0");
		const rel = `./assets/${relDir}/${pageNum}.webp`;

		// Déjà local → on garde tel quel.
		if (!isExternal(src)) {
			local.push(src);
			continue;
		}
		if (dryRun) {
			local.push(rel);
			continue;
		}
		if ((await freeBytes()) < MIN_FREE_BYTES) {
			console.error(`   ⚠️ garde-fou disque (<800 Mo) — abandon du chapitre ${ch.id}`);
			return { ok: false, pages: ch.pages };
		}
		const headers: Record<string, string> = { "User-Agent": UA };
		const ref = refererFor(src);
		if (ref) headers.Referer = ref;
		let buf: Uint8Array;
		try {
			const r = await fetch(src, { headers });
			if (!r.ok) {
				console.warn(`   ✗ ch${ch.id} p${pageNum} → HTTP ${r.status}`);
				return { ok: false, pages: ch.pages };
			}
			const raw = new Uint8Array(await r.arrayBuffer());
			buf = new Uint8Array(await sharp(raw).webp({ quality: 72 }).toBuffer());
		} catch (e) {
			console.warn(`   ✗ ch${ch.id} p${pageNum}: ${(e as Error).message}`);
			return { ok: false, pages: ch.pages };
		}
		await Bun.write(join(absDir, `${pageNum}.webp`), buf);
		local.push(rel);
		await sleep(80);
	}
	return { ok: true, pages: local };
}

async function main() {
	console.log(`🛡️  Self-host des scans N&B${dryRun ? " (dry-run)" : ""}`);
	console.log(`   libre: ${((await freeBytes()) / 2 ** 30).toFixed(2)} Go`);

	let rows = await sql<Chapter[]>`
		SELECT id, series, chapter_number, pages
		FROM bot.db_manga_chapters
		WHERE pages IS NOT NULL AND jsonb_array_length(pages) > 0
		${series ? sql`AND series = ${series}` : sql``}
		${onlyChapter ? sql`AND id = ${onlyChapter}` : sql``}
		ORDER BY series, chapter_number`;

	// Ne garder que les chapitres ayant au moins une planche externe.
	rows = rows.filter((c) => Array.isArray(c.pages) && c.pages.some(isExternal));
	console.log(`   ${rows.length} chapitre(s) à rapatrier.`);

	let done = 0;
	let failed = 0;
	for (const ch of rows) {
		if (done >= limit) {
			console.log(`\n🛑 limite ${limit} atteinte.`);
			break;
		}
		const ext = ch.pages.filter(isExternal).length;
		console.log(
			`\n📄 ${ch.series} #${ch.chapter_number} (id ${ch.id}) — ${ext} planche(s) externe(s)`
		);
		const { ok, pages } = await selfhostChapter(ch);
		if (!ok) {
			failed++;
			continue;
		}
		if (!dryRun) {
			// Couverture = première planche (convention DB/DBFC), posée si elle manque.
			await sql`UPDATE bot.db_manga_chapters SET pages=${sql.json(pages)},
				cover=coalesce(nullif(btrim(cover), ''), ${pages[0] ?? null}) WHERE id=${ch.id}`;
		}
		done++;
		console.log(
			`   ✅ ${pages.length} planches locales (libre: ${((await freeBytes()) / 2 ** 30).toFixed(2)} Go)`
		);
	}

	console.log(`\n✨ Terminé : ${done} rapatrié(s), ${failed} échec(s)/partiel(s).`);
	await sql.end();
}

main().catch((e) => {
	console.error("❌", e);
	process.exit(1);
});
