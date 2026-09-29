/**
 * mirror-media.ts — Rapatrie en local toutes les images distantes (posters
 * MAL, stills TMDB, covers AniList) dans apps/bot/assets/ext/ et réécrit les
 * chemins DB vers `./assets/ext/...` → site 100 % self-hosted (zéro dépendance
 * CDN externe, durable).
 *
 * Usage : bun apps/bot/scripts/mirror-media.ts
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";

const DB = new URL("../data/bot.db", import.meta.url).pathname;
const ASSETS = new URL("../assets/ext/", import.meta.url).pathname;
const db = new Database(DB);

type Target = { table: string; col: string };
const TARGETS: Target[] = [
	{ table: "db_movies", col: "poster" },
	{ table: "db_episodes", col: "image" },
	{ table: "db_manga_volumes", col: "cover" },
	{ table: "db_news", col: "image" },
];

function extOf(url: string): string {
	const m = url.split("?")[0].match(/\.(jpg|jpeg|png|webp|gif)$/i);
	return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

async function download(url: string, dest: string): Promise<boolean> {
	try {
		const res = await fetch(url, {
			headers: { "user-agent": "Mozilla/5.0", accept: "image/*" },
			signal: AbortSignal.timeout(20000),
		});
		if (!res.ok) return false;
		const buf = await res.arrayBuffer();
		if (buf.byteLength < 512) return false;
		await Bun.write(dest, buf);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	let ok = 0;
	let fail = 0;
	let skip = 0;
	for (const { table, col } of TARGETS) {
		const dir = `${ASSETS}${table}`;
		mkdirSync(dir, { recursive: true });
		const rows = db
			.query(`SELECT id, ${col} AS u FROM ${table} WHERE ${col} LIKE 'http%'`)
			.all() as { id: number; u: string }[];
		const upd = db.query(`UPDATE ${table} SET ${col} = ? WHERE id = ?`);
		// Concurrence modérée (coexiste avec recon).
		const CONC = 5;
		for (let i = 0; i < rows.length; i += CONC) {
			const batch = rows.slice(i, i + CONC);
			await Promise.all(
				batch.map(async (r) => {
					const ext = extOf(r.u);
					const rel = `./assets/ext/${table}/${r.id}.${ext}`;
					const dest = `${dir}/${r.id}.${ext}`;
					if (existsSync(dest)) {
						upd.run(rel, r.id);
						skip++;
						return;
					}
					if (await download(r.u, dest)) {
						upd.run(rel, r.id);
						ok++;
					} else {
						fail++;
					}
				})
			);
		}
		console.log(`${table}.${col}: ${rows.length} distantes traitées`);
	}
	console.log(`\nMirror : ${ok} téléchargées, ${skip} déjà locales, ${fail} échecs.`);
	db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
