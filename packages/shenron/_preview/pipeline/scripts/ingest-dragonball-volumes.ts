/**
 * ingest-dragonball-volumes.ts — Ingestion du **Dragon Ball original complet**
 * (43 tomes VF, N&B) depuis Sushi Scan vers nos assets + Neon. Remplit l'œuvre
 * originale (l'onglet « Dragon Ball » ne montrait que l'édition couleur).
 *
 * Source : pages-lecteur `sushiscan.fr/dragon-ball-volume-N-vf/` (ts_reader →
 * CDN anime-sama). Téléchargé sur le VPS, **converti N&B + redimensionné 1280 +
 * WebP q55** (manga N&B compresse bien → ~150 Ko/planche au lieu de ~440 Ko) pour
 * tenir sur le disque. Un chapitre lisible par tome, rattaché au volume existant
 * `Dragon Ball Vol. N`. Pages promo « SUSHISCAN » / crédits retirées par OCR
 * (bords du tome). Garde-fou disque + idempotent.
 *
 * Env requis : DATABASE_URL (Neon).
 * Usage : env DATABASE_URL=… bun scripts/ingest-dragonball-volumes.ts [--from 1] [--to 43] [--force] [--dry-run]
 */
import postgres from "postgres";
import sharp from "sharp";
import { mkdir, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { recogniseRemotePage } from "@shenron/pipeline/aphrody/remote-ocr";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const argN = (k: string, d: number) => {
	const i = args.indexOf(k);
	return i !== -1 ? Number(args[i + 1]) : d;
};
const FROM = argN("--from", 1);
const TO = argN("--to", 43);

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ASSETS_ROOT = join(import.meta.dir, "..", "assets");
const MIN_FREE_BYTES = 1200 * 1024 * 1024; // garde-fou conservateur : 1.2 Go
const HEADERS = { "User-Agent": UA, Referer: "https://sushiscan.fr/" };

const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freeBytes = async () => {
	const s = await statfs(ASSETS_ROOT);
	return s.bavail * s.bsize;
};

async function readerImages(volume: number): Promise<string[]> {
	const url = `https://sushiscan.fr/dragon-ball-volume-${volume}-vf/`;
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) throw new Error(`reader vol ${volume} → HTTP ${res.status}`);
	const html = await res.text();
	const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
	if (!m) throw new Error("ts_reader introuvable");
	const cfg = JSON.parse(m[1]) as { sources?: { images?: string[] }[] };
	return cfg.sources?.flatMap((s) => s.images ?? []) ?? [];
}

/** Aphrody OCR → true si la planche est une pub/crédits (à retirer). */
async function isPromo(absPath: string): Promise<boolean> {
	try {
		const png = await sharp(absPath).resize(1100).png().toBuffer();
		const result = await recogniseRemotePage(new Uint8Array(png));
		if (result.suspect || result.quality.mean_confidence < 0.8) return false;
		const t = result.text.toLowerCase().replace(/\s+/g, " ");
		if (t.includes("sushiscan")) return true;
		if (t.includes("lisez") && t.includes("chapitres")) return true;
		if (/lettering|translator|traduction|interior design/.test(t)) return true;
	} catch {
		/* OCR raté → on garde la planche */
	}
	return false;
}

async function ingestVolume(volume: number, volumeId: number): Promise<void> {
	// Idempotent : déjà ingéré ?
	if (!force) {
		const ex = await sql<{ id: number }[]>`
			SELECT id FROM bot.db_manga_chapters
			WHERE volume_id=${volumeId} AND title=${`Tome ${volume}`}
			  AND pages IS NOT NULL AND jsonb_array_length(pages) > 0 LIMIT 1`;
		if (ex.length > 0) {
			console.log(`   ⏭️  Tome ${volume} déjà ingéré`);
			return;
		}
	}

	const images = await readerImages(volume);
	console.log(`   ${images.length} planches listées`);
	if (images.length === 0) return;

	const relDir = `manga/DB/regular/vol${volume}`;
	const absDir = join(ASSETS_ROOT, relDir);
	if (!dryRun) await mkdir(absDir, { recursive: true });

	const local: string[] = [];
	const edges = new Set([0, 1, 2, images.length - 1, images.length - 2, images.length - 3]);
	for (let i = 0; i < images.length; i++) {
		if ((await freeBytes()) < MIN_FREE_BYTES) {
			console.error(`   ⚠️ garde-fou disque (<1.2 Go) — arrêt`);
			throw new Error("disk-guard");
		}
		const pageNum = String(i + 1).padStart(3, "0");
		const rel = `./assets/${relDir}/${pageNum}.webp`;
		if (dryRun) {
			local.push(rel);
			continue;
		}
		try {
			const r = await fetch(images[i], { headers: HEADERS });
			if (!r.ok) {
				console.warn(`   ✗ p${pageNum} HTTP ${r.status}`);
				continue;
			}
			const raw = new Uint8Array(await r.arrayBuffer());
			const webp = await sharp(raw)
				.grayscale()
				.resize(1280, null, { withoutEnlargement: true })
				.webp({ quality: 55, effort: 4 })
				.toBuffer();
			const abs = join(absDir, `${pageNum}.webp`);
			await Bun.write(abs, webp);
			// Promo seulement aux bords du tome (rapide).
			if (edges.has(i) && (await isPromo(abs))) {
				await unlink(abs).catch(() => {});
				console.log(`   🧹 p${pageNum} retirée (pub/crédits)`);
				continue;
			}
			local.push(rel);
		} catch (e) {
			console.warn(`   ✗ p${pageNum}: ${(e as Error).message}`);
		}
		if ((i + 1) % 40 === 0) console.log(`   …${i + 1}/${images.length}`);
		await sleep(60);
	}

	if (dryRun || local.length === 0) return;
	const cover = local[0];
	await sql`
		INSERT INTO bot.db_manga_chapters (series, chapter_number, title, cover, pages, volume_id)
		VALUES ('DB', ${volume}, ${`Tome ${volume}`}, ${cover}, ${sql.json(local)}, ${volumeId})
		ON CONFLICT DO NOTHING`;
	console.log(
		`   ✅ Tome ${volume} : ${local.length} planches (libre ${((await freeBytes()) / 2 ** 30).toFixed(2)} Go)`
	);
}

async function main() {
	console.log(
		`📚 Ingestion Dragon Ball original (tomes ${FROM}→${TO})${dryRun ? " (dry-run)" : ""}`
	);
	console.log(`   libre: ${((await freeBytes()) / 2 ** 30).toFixed(2)} Go`);
	const vols = await sql<{ id: number; volume_number: number }[]>`
		SELECT id, volume_number FROM bot.db_manga_volumes WHERE title LIKE 'Dragon Ball Vol. %'`;
	const idByNum = new Map(vols.map((v) => [Number(v.volume_number), v.id]));

	for (let n = FROM; n <= TO; n++) {
		const vid = idByNum.get(n);
		if (!vid) {
			console.log(`\n📕 Tome ${n} — pas de volume « Dragon Ball Vol. ${n} » en base, skip`);
			continue;
		}
		console.log(`\n📕 Tome ${n} (volume_id ${vid})`);
		try {
			await ingestVolume(n, vid);
		} catch (e) {
			if ((e as Error).message === "disk-guard") {
				console.error("🛑 Arrêt sur garde-fou disque.");
				break;
			}
			console.error(`   ❌ Tome ${n}: ${(e as Error).message}`);
		}
	}
	console.log("\n✨ Terminé.");
	await sql.end();
}

main().catch((e) => {
	console.error("❌", e);
	process.exit(1);
});
