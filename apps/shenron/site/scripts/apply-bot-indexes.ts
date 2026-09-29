/**
 * Applique `src/db/bot-indexes.sql` — les index manquants des schémas `bot` et
 * `public` — puis relance `ANALYZE`.
 *
 * Deux raisons de passer par un script plutôt que `drizzle-kit push` :
 *   1. `push` sur le schéma `bot` voudrait droper les colonnes qui n'existent
 *      que côté PostgreSQL (`players`, `frames`, `pages`, `subtitles`) ;
 *   2. `drizzle-kit migrate` sort en erreur silencieuse sous Bun (cf. CLAUDE.md).
 *
 * Le `ANALYZE` final n'est pas cosmétique : mesuré le 2026-08-21, cinq tables du
 * wiki (`db_characters`, `db_planets`, `db_races`, `db_techniques`,
 * `db_manga_chapters`) n'avaient JAMAIS été analysées — `last_analyze` et
 * `last_autoanalyze` à NULL — donc le planificateur voyait 0 ligne là où il y en
 * avait 1 323, et choisissait un balayage séquentiel même quand un index
 * existait. Créer les index sans rafraîchir les statistiques n'aurait rien changé.
 *
 *   bun apps/shenron/site/scripts/apply-bot-indexes.ts [--dry-run]
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

/** Découpe le fichier en ordres, en préservant les blocs `DO $$ … $$;`. */
function statements(sqlText: string): string[] {
	const out: string[] = [];
	let buf = "";
	let inDollar = false;
	for (const line of sqlText.split("\n")) {
		const bare = line.trim();
		if (bare.startsWith("--") && !inDollar) continue;
		buf += `${line}\n`;
		const dollars = (line.match(/\$\$/g) ?? []).length;
		if (dollars % 2 === 1) inDollar = !inDollar;
		if (!inDollar && bare.endsWith(";")) {
			if (buf.trim()) out.push(buf.trim());
			buf = "";
		}
	}
	if (buf.trim()) out.push(buf.trim());
	return out;
}

/** Nom lisible d'un ordre, pour le journal. */
const labelOf = (stmt: string): string =>
	stmt.match(/CREATE INDEX IF NOT EXISTS (\S+)/i)?.[1] ??
	stmt.match(/ADD CONSTRAINT (\S+)/i)?.[1] ??
	stmt.split("\n")[0]?.slice(0, 60) ??
	"ordre SQL";

async function main() {
	const url = await databaseUrl();
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");
	const dryRun = process.argv.includes("--dry-run");

	const file = join(import.meta.dir, "..", "src", "db", "bot-indexes.sql");
	const stmts = statements(await readFile(file, "utf8"));
	console.log(`${stmts.length} ordres à appliquer${dryRun ? " (simulation)" : ""}.\n`);

	const sql = postgres(url, { max: 1 });
	try {
		const before = await indexCount(sql);
		let applied = 0;
		for (const stmt of stmts) {
			if (dryRun) {
				console.log(`  · ${labelOf(stmt)}`);
				continue;
			}
			const t0 = Bun.nanoseconds();
			await sql.unsafe(stmt);
			const ms = (Bun.nanoseconds() - t0) / 1e6;
			applied++;
			console.log(`  ✓ ${labelOf(stmt).padEnd(42)} ${ms.toFixed(0)} ms`);
		}
		if (dryRun) return;

		console.log("\nANALYZE…");
		// Par table et non `ANALYZE;` global : ne touche que ce qui nous concerne
		// et laisse un journal exploitable.
		const tables = await sql<Array<{ full: string }>>`
			SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS full
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relkind = 'r' AND n.nspname IN ('bot', 'public')
			ORDER BY 1`;
		for (const { full } of tables) await sql.unsafe(`ANALYZE ${full}`);
		console.log(`  ✓ ${tables.length} tables analysées`);

		const after = await indexCount(sql);
		console.log(`\n${applied} ordres appliqués. Index : ${before} → ${after}.`);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

async function databaseUrl(): Promise<string | undefined> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envPath = join(import.meta.dir, "..", ".env");
	const content = await readFile(envPath, "utf8").catch(() => "");
	return content
		.split(/\r?\n/)
		.findLast((line) => line.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^['"]|['"]$/g, "");
}

async function indexCount(sql: postgres.Sql): Promise<number> {
	const [row] = await sql<Array<{ n: number }>>`
		SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname IN ('bot', 'public')`;
	return row?.n ?? 0;
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
