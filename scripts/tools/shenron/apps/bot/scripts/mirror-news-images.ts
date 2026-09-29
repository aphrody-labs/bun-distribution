/**
 * mirror-news-images.ts — Élimine tout risque de 404 sur les images news.
 *
 * Les 21 dernières images db_news pointent vers des CDN externes (TikTok/Discord
 * avec x-expires périmés = morts, ytimg/imgur = vivants). Pour chaque URL externe :
 *   - 200 + image → téléchargée dans ./assets/ext/db_news/ + path DB réécrit self-hosted
 *   - sinon (404/timeout) → image mise à NULL (le front affiche un placeholder)
 *
 * Résultat : 100% des images db_news servies en 200 (ou null), aucune 404 externe.
 * Usage : bun apps/bot/scripts/mirror-news-images.ts
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Racine du package bot, robuste quel que soit le CWD (repo root ou apps/bot).
const BOT_ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const ASSET_DIR = join(BOT_ROOT, "assets/ext/db_news");
const DB_PATH = join(BOT_ROOT, "data/bot.db");

const EXT_BY_CT: Record<string, string> = {
	"image/webp": "webp",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/avif": "avif",
};

mkdirSync(ASSET_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000;");

const rows = db.query('SELECT id, image FROM db_news WHERE image LIKE "http%"').all() as Array<{
	id: number;
	image: string;
}>;

let mirrored = 0;
let nulled = 0;

for (const r of rows) {
	let ok = false;
	try {
		const res = await fetch(r.image, {
			signal: AbortSignal.timeout(15_000),
			headers: { "user-agent": "Mozilla/5.0 (compatible; DBFRBot/1.0)" },
		});
		const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
		if (res.ok && EXT_BY_CT[ct]) {
			const buf = new Uint8Array(await res.arrayBuffer());
			if (buf.byteLength > 512) {
				const ext = EXT_BY_CT[ct];
				const rel = `./assets/ext/db_news/news-${r.id}.${ext}`;
				await Bun.write(join(ASSET_DIR, `news-${r.id}.${ext}`), buf);
				db.query("UPDATE db_news SET image = ? WHERE id = ?").run(rel, r.id);
				mirrored++;
				ok = true;
				console.log(`  ✓ news#${r.id} mirroré (${ct}, ${buf.byteLength} o)`);
			}
		}
	} catch (e) {
		/* mort → null ci-dessous */
	}
	if (!ok) {
		db.query("UPDATE db_news SET image = NULL WHERE id = ?").run(r.id);
		nulled++;
		console.log(`  ✗ news#${r.id} mort → image NULL (${r.image.slice(0, 50)}…)`);
	}
}

console.log(`\n✓ news mirrorées : ${mirrored} · mises à null (mortes) : ${nulled}`);
db.close();
