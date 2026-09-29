/**
 * seed-pg-from-sqlite.ts — Seed initial du schéma Postgres **`bot`** depuis le
 * réplica SQLite du bot (`apps/bot/data/bot.db`).
 *
 * Contexte : migration Neon → PostgreSQL local (VPS, 2026-06-23). Neon ayant
 * dépassé son quota de transfert, ses données `bot.*` (wiki éditorial) sont
 * inaccessibles. Le SQLite du bot en est un **réplica complet** → on reconstruit
 * le schéma `bot` du PG local à partir de lui.
 *
 * Différence avec `sync-sqlite-to-neon.ts` (forward) :
 *  - on N'EXCLUT PAS le wiki éditorial (ici, SQLite est la SEULE source restante) ;
 *  - on N'IMPOSE PAS le type SQLite : les tables `bot.*` ont déjà été créées par
 *    Drizzle (`drizzle.config.bot.ts` → `bot-schema.ts`) avec leurs colonnes
 *    Neon-only (`players`, `subtitles`, `frames`, `pages`, `stream_*`). On insère
 *    donc par **intersection de colonnes** (SQLite ∩ Postgres) : les colonnes
 *    Neon-only, absentes du SQLite, restent NULL (re-dérivées ensuite par
 *    `import-voiranime-players*.ts` et `selfhost-manga-pages.ts`).
 *
 * Pas de conversion de date : `bot-schema.ts` stocke les dates en **bigint
 * (secondes epoch)**, identique au SQLite → copie directe. Aucune FK sur `bot.*`
 * (cf. bot-schema.ts) → ordre d'insertion indifférent, TRUNCATE sûr.
 *
 * Idempotent : TRUNCATE + INSERT par table dans une transaction. Relançable.
 *
 * Env requis : DATABASE_URL = PostgreSQL local (`~/.shenron-neon.env`).
 * Usage : cd apps/bot && bun scripts/seed-pg-from-sqlite.ts [--dry-run]
 */
import { Database } from "bun:sqlite";
import postgres from "postgres";

const SQLITE_PATH = process.env.BOT_DB ?? new URL("../data/bot.db", import.meta.url).pathname;
const PG_URL = process.env.DATABASE_URL;
const DRY = process.argv.includes("--dry-run");

if (!PG_URL) {
	console.error("✗ DATABASE_URL (PostgreSQL local) requis dans l'environnement.");
	process.exit(1);
}
if (/neon\.tech/i.test(PG_URL)) {
	console.error("✗ DATABASE_URL pointe encore sur Neon — abandon (ce seed est pour le PG local).");
	process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const sql = postgres(PG_URL, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
	// Tables réellement présentes dans le schéma `bot` du PG (créées par Drizzle).
	const pgTables = (
		await sql<{ table_name: string }[]>`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'bot' AND table_type = 'BASE TABLE'
			ORDER BY table_name`
	).map((r) => r.table_name);

	const report: { table: string; src: number; dst: number; cols: number; ok: boolean }[] = [];

	for (const t of pgTables) {
		// Colonnes côté Postgres (avec type pour le cas jsonb défensif).
		const pgCols = await sql<{ column_name: string; data_type: string }[]>`
			SELECT column_name, data_type FROM information_schema.columns
			WHERE table_schema = 'bot' AND table_name = ${t}`;
		const pgColType = new Map(pgCols.map((c) => [c.column_name, c.data_type]));

		// La table existe-t-elle côté SQLite ?
		const sqliteCols = (sqlite.query(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(
			(c) => c.name
		);
		if (sqliteCols.length === 0) {
			console.warn(`! bot.${t.padEnd(26)} absente du SQLite — skip`);
			report.push({ table: t, src: 0, dst: 0, cols: 0, ok: true });
			continue;
		}

		// Intersection, dans l'ordre SQLite. Les colonnes Neon-only (jsonb absentes
		// du SQLite) sont ainsi naturellement exclues → restent NULL côté PG.
		const cols = sqliteCols.filter((c) => pgColType.has(c));

		const rows = sqlite.query(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[];

		// Normalisation des valeurs : BLOB → Buffer (bytea), jsonb défensif (si une
		// colonne de l'intersection était jsonb côté PG mais texte côté SQLite).
		const projected = rows.map((row) => {
			const out: Record<string, unknown> = {};
			for (const c of cols) {
				let v = row[c];
				if (v instanceof Uint8Array && !(v instanceof Buffer)) v = Buffer.from(v);
				if (pgColType.get(c) === "jsonb" && typeof v === "string") {
					try {
						v = sql.json(JSON.parse(v));
					} catch {
						/* laisse la valeur telle quelle si non-JSON */
					}
				}
				out[c] = v ?? null;
			}
			return out;
		});

		if (DRY) {
			console.log(`· bot.${t.padEnd(26)} sqlite=${rows.length} cols=${cols.length} (dry-run)`);
			report.push({ table: t, src: rows.length, dst: rows.length, cols: cols.length, ok: true });
			continue;
		}

		await sql.begin(async (tx) => {
			await tx.unsafe(`TRUNCATE bot."${t}"`);
			const BATCH = 500;
			for (let i = 0; i < projected.length; i += BATCH) {
				const chunk = projected.slice(i, i + BATCH);
				if (chunk.length === 0) continue;
				await tx`INSERT INTO bot.${tx(t)} ${tx(chunk, ...cols)}`;
			}
		});

		const [{ count }] = await sql`SELECT count(*)::int AS count FROM bot.${sql(t)}`;
		const ok = rows.length === Number(count);
		report.push({ table: t, src: rows.length, dst: Number(count), cols: cols.length, ok });
		console.log(
			`${ok ? "✓" : "✗"} bot.${t.padEnd(26)} sqlite=${rows.length} pg=${count} (cols=${cols.length})`
		);
	}

	const total = report.reduce((s, r) => s + r.dst, 0);
	const bad = report.filter((r) => !r.ok);
	console.log(`\n${report.length} tables · ${total} lignes seedées · ${bad.length} mismatch`);

	await sql.end();
	sqlite.close();
	if (bad.length) {
		console.error("✗ Mismatch de counts — seed incomplet.");
		process.exit(1);
	}
	console.log(
		`✓ Seed SQLite → PostgreSQL (schéma bot)${DRY ? " (dry-run)" : ""} complet et vérifié.`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
