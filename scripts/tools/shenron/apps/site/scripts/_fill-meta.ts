/**
 * Shared plumbing of the metadata fill scripts (`fill-games-metadata.ts`,
 * `fill-planets-names.ts`, `fill-arcs-names.ts`, `fill-sagas-chapters.ts`,
 * `races-planete-origine.ts`).
 *
 * Every script reads bxc scrapes stored OUTSIDE the repository
 * (`~/.shenron-build-tmp/scrape/meta/`, overridable with `META_SCRAPE_DIR`),
 * simulates by default, and only writes with `--apply` (`--appliquer` accepted).
 *
 * Writes go to PostgreSQL `bot.*` — the wiki source of truth, never the bot SQLite —
 * and only into EMPTY cells: the row is locked, re-read, and a column that someone
 * filled in the meantime is left alone. Each touched row gets exactly one
 * `public.wiki_revisions` entry holding the previous and new value of every column
 * written, so `/admin/wiki/history` can revert it.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

export const SCRAPE_DIR =
	process.env.META_SCRAPE_DIR ?? join(homedir(), ".shenron-build-tmp", "scrape", "meta");

export const APPLY = process.argv.includes("--apply") || process.argv.includes("--appliquer");

export type Sql = ReturnType<typeof postgres>;

/** A MediaWiki page as written by `bxc wiki page --out`. */
export type WikiPage = {
	titre: string;
	revid: number | null;
	wikitext: string | null;
	sections?: { niveau: number; titre: string; ancre: string }[];
	infobox?: Record<string, { brut: string; propre: string }>[];
};

/** Tables these scripts may write. */
export type FillTable = "db_games" | "db_planets" | "db_arcs" | "db_sagas" | "db_races";
const TABLES = new Set<string>(["db_games", "db_planets", "db_arcs", "db_sagas", "db_races"]);

export type FieldChange = {
	table: FillTable;
	id: number;
	label: string;
	after: Record<string, string | number>;
	/** Human-readable provenance, stored in the revision's editor name. */
	source: string;
};

/** Wording that betrays an unsourced statement — refused, as in `depose-wiki.ts`. */
const UNSOURCED = /\b(probablement|sans doute|vraisemblablement|inconnue?)\b/i;

export async function connect(): Promise<Sql> {
	let url = process.env.DATABASE_URL?.trim();
	if (!url) {
		const text = await Bun.file(join(import.meta.dir, "..", ".env"))
			.text()
			.catch(() => "");
		// `.env` carries two DATABASE_URL lines (the dead Neon one first): take the last.
		url = text
			.split("\n")
			.filter((l) => l.startsWith("DATABASE_URL="))
			.pop()
			?.slice("DATABASE_URL=".length)
			.trim()
			.replace(/^["']|["']$/g, "");
	}
	if (!url) throw new Error("DATABASE_URL introuvable (variable d'environnement ou apps/site/.env)");
	return postgres(url, { max: 2, prepare: false });
}

export async function readScrape<T>(relative: string): Promise<T> {
	const file = Bun.file(join(SCRAPE_DIR, relative));
	if (!(await file.exists())) {
		throw new Error(`scrape absent : ${join(SCRAPE_DIR, relative)} — relancer le scrape bxc`);
	}
	return (await file.json()) as T;
}

export async function readScrapeText(relative: string): Promise<string> {
	const file = Bun.file(join(SCRAPE_DIR, relative));
	if (!(await file.exists())) {
		throw new Error(`scrape absent : ${join(SCRAPE_DIR, relative)} — relancer le scrape bxc`);
	}
	return await file.text();
}

export const isEmpty = (value: unknown): boolean =>
	value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** Revision id in the site's format (24 base36 characters). */
const revisionId = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

/** Prints the planned changes, one block per row. */
export function printChanges(changes: FieldChange[]): void {
	for (const c of changes) {
		console.log(`${c.table}#${c.id} « ${c.label} »`);
		for (const [column, value] of Object.entries(c.after)) {
			console.log(`  ${column.padEnd(20)} ∅ → ${value}`);
		}
		console.log(`  source : ${c.source}`);
	}
}

/**
 * Writes the changes, empty cells only, one revision per row.
 * Returns the number of rows and cells actually written.
 */
export async function applyChanges(
	sql: Sql,
	changes: FieldChange[],
	tool: string
): Promise<{ rows: number; cells: number }> {
	let rows = 0;
	let cells = 0;
	for (const change of changes) {
		if (!TABLES.has(change.table)) throw new Error(`table refusée : ${change.table}`);
		const columns = Object.keys(change.after);
		for (const column of columns) {
			if (!/^[a-z_]+$/.test(column)) throw new Error(`colonne invalide : ${column}`);
			const value = change.after[column];
			if (typeof value === "string" && UNSOURCED.test(value)) {
				throw new Error(`tournure non sourcée dans ${change.table}#${change.id}.${column}`);
			}
		}
		if (columns.length === 0) continue;

		const written = await sql.begin(async (tx) => {
			const [current] = (await tx.unsafe(
				`SELECT ${columns.join(", ")} FROM bot.${change.table} WHERE id = $1 FOR UPDATE`,
				[change.id]
			)) as unknown as Record<string, unknown>[];
			if (!current) return 0;
			const before: Record<string, unknown> = {};
			const after: Record<string, string | number> = {};
			for (const column of columns) {
				if (!isEmpty(current[column])) continue;
				const value = change.after[column]!;
				await tx.unsafe(`UPDATE bot.${change.table} SET ${column} = $1 WHERE id = $2`, [
					value,
					change.id,
				]);
				before[column] = current[column] ?? null;
				after[column] = value;
			}
			const count = Object.keys(after).length;
			if (count === 0) return 0;
			// `sql.json` and not `JSON.stringify(...)::jsonb`: the latter stores a string scalar
			// and silently breaks the revert of /admin/wiki/history (docs/pieges.md).
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: revisionId(),
				tableName: change.table,
				rowId: String(change.id),
				action: "update",
				label: change.label,
				before: sql.json(before as Parameters<typeof sql.json>[0]),
				after: sql.json(after as Parameters<typeof sql.json>[0]),
				editorId: "agent",
				editorName: `Agent ${tool} (${change.source})`,
			})}`;
			return count;
		});
		if (written > 0) {
			rows++;
			cells += written;
		}
	}
	return { rows, cells };
}
