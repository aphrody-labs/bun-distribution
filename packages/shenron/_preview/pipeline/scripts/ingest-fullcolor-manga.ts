/**
 * ingest-fullcolor-manga.ts — Ingestion des scans **couleur** Dragon Ball
 * (édition « Full Color ») depuis Sushi Scan vers nos propres assets + Neon.
 *
 * Contrairement au N&B (hotlinké depuis scan-vf.net), ici on **télécharge** les
 * planches couleur sur le VPS (`apps/bot/assets/manga/DB/fullcolor/…`) et on les
 * sert depuis bot.dragonballfr.com — zéro dépendance à un site tiers au runtime.
 *
 * Source : page-lecteur Sushi Scan (`ts_reader.run({sources:[{images:[…]}]})`),
 * images hébergées sur le CDN anime-sama (déjà en .webp 1500×2000). On crée une
 * entrée chapitre lisible par tome dans `bot.db_manga_chapters` (série DB), avec
 * un `chapter_number` réservé (range 900+) et un titre « Full Color … ».
 *
 * Env requis : DATABASE_URL (Neon).
 * Usage :
 *   sudo systemd-run --pipe -p EnvironmentFile=/home/ubuntu/.shenron-neon.env \
 *     --working-directory=/home/ubuntu/shenron/apps/bot \
 *     bun scripts/ingest-fullcolor-manga.ts [--dry-run]
 *   # puis: systemctl restart shenron  (recharge le schéma + relâche le lock)
 */
import postgres from "postgres";
import { mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ASSETS_ROOT = join(import.meta.dir, "..", "assets");
const MIN_FREE_BYTES = 800 * 1024 * 1024; // garde-fou : ne pas descendre sous 800 Mo libres

const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Éditions/tomes couleur à ingérer. `cdnHint` = libellé de dossier CDN (au cas où). */
type ColorTome = {
	chapterNumber: number; // range réservé 900+
	title: string;
	readerUrl: string; // page-lecteur Sushi Scan du tome
};

const TOMES: ColorTome[] = [
	{
		chapterNumber: 901,
		title: "Full Color — L'enfance de Goku · Tome 1",
		readerUrl: "https://sushiscan.fr/dragon-ball-full-color-lenfance-de-goku-volume-1/",
	},
	{
		chapterNumber: 902,
		title: "Full Color — L'enfance de Goku · Tome 2",
		readerUrl: "https://sushiscan.fr/dragon-ball-full-color-lenfance-de-goku-volume-2/",
	},
];

async function freeBytes(): Promise<number> {
	const s = await statfs(ASSETS_ROOT);
	return s.bavail * s.bsize;
}

/** Extrait la liste d'images de la page-lecteur Sushi Scan (ts_reader.run). */
async function readerImages(readerUrl: string): Promise<string[]> {
	const res = await fetch(readerUrl, {
		headers: { "User-Agent": UA, Referer: "https://sushiscan.fr/" },
	});
	if (!res.ok) throw new Error(`reader ${readerUrl} → HTTP ${res.status}`);
	const html = await res.text();
	const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
	if (!m) throw new Error("ts_reader.run introuvable");
	const cfg = JSON.parse(m[1]) as { sources?: { images?: string[] }[] };
	const images = cfg.sources?.flatMap((s) => s.images ?? []) ?? [];
	if (images.length === 0) throw new Error("aucune image dans ts_reader");
	return images;
}

async function downloadTome(tome: ColorTome): Promise<string[]> {
	const images = await readerImages(tome.readerUrl);
	console.log(`   ${images.length} planches couleur listées`);
	const slug = `t${tome.chapterNumber}`;
	const relDir = `manga/DB/fullcolor/enfance-goku/${slug}`;
	const absDir = join(ASSETS_ROOT, relDir);
	if (!dryRun) await mkdir(absDir, { recursive: true });

	const localPaths: string[] = [];
	for (let i = 0; i < images.length; i++) {
		const pageNum = String(i + 1).padStart(3, "0");
		const relPath = `./assets/${relDir}/${pageNum}.webp`;
		localPaths.push(relPath);
		if (dryRun) continue;

		if ((await freeBytes()) < MIN_FREE_BYTES) {
			console.error(`   ⚠️ garde-fou disque atteint (<800 Mo libres) — arrêt du tome`);
			break;
		}
		const r = await fetch(images[i], {
			headers: { "User-Agent": UA, Referer: "https://sushiscan.fr/" },
		});
		if (!r.ok) {
			console.warn(`   ✗ page ${pageNum} → HTTP ${r.status} (skip)`);
			localPaths.pop();
			continue;
		}
		const buf = new Uint8Array(await r.arrayBuffer());
		await Bun.write(join(absDir, `${pageNum}.webp`), buf);
		if ((i + 1) % 20 === 0) console.log(`   …${i + 1}/${images.length}`);
		await sleep(120);
	}
	return localPaths;
}

async function upsertChapter(tome: ColorTome, pages: string[]) {
	if (dryRun || pages.length === 0) return;
	// Idempotent : repère par titre exact dans la série DB.
	const existing = await sql<{ id: number }[]>`
		SELECT id FROM bot.db_manga_chapters WHERE series='DB' AND title=${tome.title} LIMIT 1`;
	const cover = pages[0];
	if (existing.length > 0) {
		await sql`
			UPDATE bot.db_manga_chapters
			SET pages=${sql.json(pages)}, cover=${cover}, chapter_number=${tome.chapterNumber}
			WHERE id=${existing[0].id}`;
		console.log(`   ↻ chapitre couleur mis à jour (id ${existing[0].id}, ${pages.length} pages)`);
	} else {
		const [row] = await sql<{ id: number }[]>`
			INSERT INTO bot.db_manga_chapters (series, chapter_number, title, cover, pages)
			VALUES ('DB', ${tome.chapterNumber}, ${tome.title}, ${cover}, ${sql.json(pages)})
			RETURNING id`;
		console.log(`   ＋ chapitre couleur créé (id ${row.id}, ${pages.length} pages)`);
	}
}

async function main() {
	console.log(`🎨 Ingestion Dragon Ball Full Color${dryRun ? " (dry-run)" : ""}`);
	console.log(
		`   assets: ${ASSETS_ROOT}  ·  libre: ${((await freeBytes()) / 2 ** 30).toFixed(2)} Go`
	);
	for (const tome of TOMES) {
		console.log(`\n📕 ${tome.title}`);
		try {
			const pages = await downloadTome(tome);
			await upsertChapter(tome, pages);
		} catch (e) {
			console.error(`   ❌ ${tome.title}: ${(e as Error).message}`);
		}
	}
	console.log("\n✨ Terminé.");
	await sql.end();
}

main().catch((e) => {
	console.error("❌", e);
	process.exit(1);
});
