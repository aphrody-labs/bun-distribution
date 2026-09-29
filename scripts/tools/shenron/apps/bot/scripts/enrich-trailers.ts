/**
 * enrich-trailers.ts — Trouve les trailers (films + jeux) via YouTube Data API.
 *
 * Pour chaque film/jeu sans trailer : recherche YouTube "{titre} trailer",
 * stocke l'URL watch dans db_movies.trailer_url / db_games.trailer_url.
 *
 * Clé : YOUTUBE_API_KEY (env) — créée via gcloud, jamais commitée.
 * Quota : search.list coûte 100 unités (défaut 10 000/jour ≈ 100 recherches).
 *
 * Usage : YOUTUBE_API_KEY=$(cat ~/.shenron-yt.key) bun apps/bot/scripts/enrich-trailers.ts
 */
import { Database } from "bun:sqlite";

const DB = process.env.BOT_DB ?? new URL("../data/bot.db", import.meta.url).pathname;
const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) {
	console.error("✗ YOUTUBE_API_KEY requis.");
	process.exit(1);
}

if (!Bun.env.ALLOW_SQLITE_WIKI_WRITE) {
	console.error(
		"Wiki migre sur Neon (source de verite) -- ecriture SQLite ecrasee par le reverse-sync. Edite via le site, ou ALLOW_SQLITE_WIKI_WRITE=1 pour forcer."
	);
	process.exit(1);
}
const db = new Database(DB);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ytSearch(q: string): Promise<string | null> {
	const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(q)}&key=${KEY}`;
	const res = await fetch(url);
	if (!res.ok) {
		console.error(`  YouTube ${res.status}`);
		return null;
	}
	const data = (await res.json()) as {
		items?: { id?: { videoId?: string } }[];
	};
	const id = data.items?.[0]?.id?.videoId;
	return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

async function enrich(
	table: string,
	titleCol: string,
	suffix: string
): Promise<{ added: number; total: number }> {
	const rows = db
		.query(
			`SELECT id, ${titleCol} AS title, trailer_url FROM ${table} WHERE trailer_url IS NULL OR trailer_url=''`
		)
		.all() as { id: number; title: string; trailer_url: string | null }[];
	const upd = db.query(`UPDATE ${table} SET trailer_url = ? WHERE id = ?`);
	let added = 0;
	for (const r of rows) {
		const url = await ytSearch(`${r.title} ${suffix}`);
		await sleep(250);
		if (url) {
			upd.run(url, r.id);
			added++;
			console.log(`✓ ${table} · ${r.title} → ${url}`);
		} else {
			console.log(`✗ ${table} · ${r.title} — pas de trailer`);
		}
	}
	const total = (
		db
			.query(`SELECT COUNT(*) c FROM ${table} WHERE trailer_url IS NOT NULL AND trailer_url<>''`)
			.get() as { c: number }
	).c;
	const grand = (db.query(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
	console.log(`→ ${table} : +${added}, couverture ${total}/${grand}\n`);
	return { added, total };
}

function hasColumn(table: string, col: string): boolean {
	const cols = db.query(`PRAGMA table_info(${table})`).all() as {
		name: string;
	}[];
	return cols.some((c) => c.name === col);
}

async function main() {
	await enrich("db_movies", "title", "Dragon Ball film trailer officiel");
	// db_games n'a pas (encore) de colonne trailer_url → skip proprement.
	if (hasColumn("db_games", "trailer_url")) {
		await enrich("db_games", "title", "Dragon Ball game trailer");
	} else {
		console.log("→ db_games : pas de colonne trailer_url, skip.");
	}
	db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
