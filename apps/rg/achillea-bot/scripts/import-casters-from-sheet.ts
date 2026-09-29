#!/usr/bin/env bun
/**
 * T-2.5 — Import casters depuis Google Drive (one-shot, dry-run par défaut)
 *
 * Source : $ACHILLEA_CASTERS_DOC ou --source <path>
 *
 * Format détecté par extension :
 *   - .docx : extraction texte via parsing XML brut (`unzip -p ... word/document.xml`)
 *             puis split par ligne → split par séparateurs (`-`, `,`, `|`, `/`).
 *             Aucune colonne `discord_id` attendue → tout va dans `unresolved`.
 *   - .xlsx : SheetJS (lazy import, requiert `bun add xlsx` — non installé par défaut).
 *   - .csv  : parsing natif Bun.file (header obligatoire).
 *
 * Pipeline :
 *   1. parse → array { name, discord_id?, twitch?, role?, bio? }
 *   2. pour chaque entrée : si discord_id → upsert table `user` (snowflake = id PK).
 *      Sinon → unresolved[] (résolution Discord API hors scope MVP).
 *   3. rapport JSON sur stdout : { totalRows, created, updated, skipped, unresolved }
 *
 * CLI :
 *   --source <path>   défaut: Liste caster.docx
 *   --dry-run         défaut: true
 *   --apply           override dry-run, déclenche commit
 *   --verbose         logs détaillés par row
 *
 * Choix d'implémentation : **Bun.SQL natif** plutôt que Mikro-ORM.
 *   Les entités prod ont un cycle d'imports documenté (cf. tests/setup.ts L8-12)
 *   qui rend le bootstrap d'un MikroORM standalone hors du build CJS impossible.
 *   Pour un script one-shot d'import qui touche une seule table (`user`),
 *   Bun.SQL est plus rapide, sans deps, et évite ce piège.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { createBunSql } from "@rosegriffon/db/bun-sql";

import { normalizeNames } from "../src/utils/functions/normalizeName";

// Chemin du document source — fournir via $ACHILLEA_CASTERS_DOC ou --source <path>.
const DEFAULT_SOURCE = process.env.ACHILLEA_CASTERS_DOC ?? "";

// ===========================================================================
// CLI parsing
// ===========================================================================

interface CliOptions {
	source: string;
	dryRun: boolean;
	verbose: boolean;
}

function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = { source: DEFAULT_SOURCE, dryRun: true, verbose: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--source") opts.source = argv[++i] ?? opts.source;
		else if (a === "--apply") opts.dryRun = false;
		else if (a === "--dry-run") opts.dryRun = true;
		else if (a === "--verbose" || a === "-v") opts.verbose = true;
		else if (a === "--help" || a === "-h") {
			console.log(
				"Usage: bun scripts/import-casters-from-sheet.ts [--source <path>] [--apply] [--verbose]"
			);
			process.exit(0);
		}
	}
	return opts;
}

// ===========================================================================
// Parsers
// ===========================================================================

export interface CasterRow {
	name: string;
	discordId?: string;
	twitch?: string;
	role?: string;
	bio?: string;
	/** ligne brute source (pour debug) */
	rawLine?: string;
}

/** Extrait `<w:t>...</w:t>` brut groupé par paragraphe `<w:p>`. */
export function parseDocxXml(xml: string): string[] {
	const paragraphs: string[] = [];
	const paraRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
	const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
	let m: RegExpExecArray | null;
	while ((m = paraRegex.exec(xml)) !== null) {
		const inner = m[1];
		let text = "";
		let t: RegExpExecArray | null;
		while ((t = textRegex.exec(inner)) !== null) {
			text += t[1];
		}
		text = text.trim();
		if (text.length > 0) paragraphs.push(text);
	}
	return paragraphs;
}

/** Lit un .docx via `unzip -p` (shell) et extrait `word/document.xml`. */
async function readDocxText(filePath: string): Promise<string> {
	const proc = Bun.spawn(["unzip", "-p", filePath, "word/document.xml"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) {
		const err = await new Response(proc.stderr).text();
		throw new Error(`unzip failed (${code}): ${err}`);
	}
	return out;
}

/**
 * Une ligne de "Liste caster.docx" ressemble à : `Tanej - Bri - Ishido - Angel`.
 * On considère chaque pseudo séparé par `-`, `,`, `|`, `/` comme une entrée.
 */
export function expandLineToRows(line: string): CasterRow[] {
	return line
		.split(/\s*[-,|/]\s*/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s.length < 64)
		.map((name) => ({ name, rawLine: line }));
}

/** Parse CSV minimal : 1ʳᵉ ligne header, virgule comme séparateur. */
export function parseCsv(text: string): CasterRow[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length < 2) return [];
	const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
	const rows: CasterRow[] = [];
	for (let i = 1; i < lines.length; i++) {
		const cols = lines[i].split(",").map((c) => c.trim());
		const rec: Record<string, string> = {};
		headers.forEach((h, idx) => (rec[h] = cols[idx] ?? ""));
		const name = rec.name || rec.pseudo || rec.username || "";
		if (!name) continue;
		rows.push({
			name,
			discordId: rec.discord_id || rec.discordid || rec.snowflake || undefined,
			twitch: rec.twitch || undefined,
			role: rec.role || undefined,
			bio: rec.bio || undefined,
		});
	}
	return rows;
}

export async function parseSource(source: string): Promise<{ rows: CasterRow[]; format: string }> {
	const ext = path.extname(source).toLowerCase();
	if (ext === ".docx") {
		const xml = await readDocxText(source);
		const paragraphs = parseDocxXml(xml);
		const rows = paragraphs.flatMap(expandLineToRows);
		return { rows, format: "docx (xml-raw)" };
	}
	if (ext === ".csv") {
		const text = await Bun.file(source).text();
		return { rows: parseCsv(text), format: "csv" };
	}
	if (ext === ".xlsx") {
		let XLSX: typeof import("xlsx");
		try {
			XLSX = await import("xlsx");
		} catch {
			throw new Error(
				".xlsx source requires `bun add xlsx` in this workspace (not installed by default)."
			);
		}
		const wb = XLSX.readFile(source);
		const sheet = wb.Sheets[wb.SheetNames[0]];
		const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
		const rows: CasterRow[] = json
			.map((rec) => {
				const name = (rec.name || rec.Pseudo || rec.pseudo || rec.Username || "").toString().trim();
				if (!name) return null;
				return {
					name,
					discordId:
						(rec.discord_id || rec.DiscordId || rec.discordId || "").toString().trim() || undefined,
					twitch: (rec.twitch || rec.Twitch || "").toString().trim() || undefined,
					role: (rec.role || rec.Role || "").toString().trim() || undefined,
					bio: (rec.bio || rec.Bio || "").toString().trim() || undefined,
				};
			})
			.filter((r): r is CasterRow => r !== null);
		return { rows, format: "xlsx (SheetJS)" };
	}
	throw new Error(`Unsupported source extension: ${ext}`);
}

// ===========================================================================
// Upsert pipeline (Bun.SQL natif)
// ===========================================================================

interface ImportReport {
	source: string;
	format: string;
	dryRun: boolean;
	totalRows: number;
	created: number;
	updated: number;
	skipped: number;
	unresolved: Array<{ name: string; reason: string; rawLine?: string }>;
}

/**
 * Lecture brute du `.env` à côté du package.json — Bun expand les `$VAR` dans
 * les valeurs non quotées, ce qui tronque les passwords contenant `$Z...`.
 * On parse soi-même le fichier sans expansion.
 */
function readDotEnvSync(envPath: string): Record<string, string> {
	if (!existsSync(envPath)) return {};
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const fs = require("node:fs") as typeof import("node:fs");
	const text = fs.readFileSync(envPath, "utf8");
	const out: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		out[key] = val;
	}
	return out;
}

function buildConnectionUrl(): string {
	// On préfère .env brut sur process.env pour éviter l'expansion `$VAR`.
	const dotenv = readDotEnvSync(path.resolve(__dirname, "../.env"));
	const pick = (...keys: string[]) => {
		for (const k of keys) {
			if (dotenv[k]) return dotenv[k];
			if (process.env[k]) return process.env[k] as string;
		}
		return "";
	};
	// Supabase-first : la connexion vient de .env (DATABASE_* → Supabase). Pas de défaut local.
	const host = pick("DATABASE_HOST", "DATABASE_HOST_DEV");
	const port = pick("DATABASE_PORT", "DATABASE_PORT_DEV") || "5432";
	const user = pick("DATABASE_USER", "DATABASE_USER_DEV") || "postgres";
	const password = pick("DATABASE_PASSWORD", "DATABASE_PASSWORD_DEV") || "";
	const dbName = pick("DATABASE_NAME", "DATABASE_NAME_DEV") || "postgres";
	if (!host)
		throw new Error("DATABASE_HOST manquant (.env Supabase requis — plus de Postgres local).");
	return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
}

export async function runImport(opts: CliOptions): Promise<ImportReport> {
	if (!existsSync(opts.source) || !statSync(opts.source).isFile()) {
		throw new Error(`Source not found or not a file: ${opts.source}`);
	}

	const { rows, format } = await parseSource(opts.source);

	const report: ImportReport = {
		source: opts.source,
		format,
		dryRun: opts.dryRun,
		totalRows: rows.length,
		created: 0,
		updated: 0,
		skipped: 0,
		unresolved: [],
	};

	const sql = createBunSql({ url: buildConnectionUrl() });

	try {
		// Transaction : commit si --apply, rollback systématique si dry-run.
		await sql.begin(async (tx) => {
			for (const row of rows) {
				if (!row.discordId) {
					report.unresolved.push({
						name: row.name,
						reason: "MANUAL RESOLUTION REQUIRED — no discord_id in source",
						rawLine: row.rawLine,
					});
					if (opts.verbose) console.error(`[unresolved] ${row.name} (line: ${row.rawLine ?? "-"})`);
					continue;
				}
				if (!/^\d{17,20}$/.test(row.discordId)) {
					report.skipped++;
					report.unresolved.push({
						name: row.name,
						reason: `invalid discord_id format: ${row.discordId}`,
					});
					if (opts.verbose) console.error(`[skipped] ${row.name} bad id ${row.discordId}`);
					continue;
				}

				const existing = await tx`
          SELECT id, username, display_name FROM "user" WHERE id = ${row.discordId} LIMIT 1
        `;
				const norm = normalizeNames(row.name);

				if (existing.length > 0) {
					const cur = existing[0] as { username: string | null; display_name: string };
					// Update doux : on n'écrase que les champs vides en DB.
					const newDisplay = cur.display_name ? cur.display_name : row.name;
					const newUsername = cur.username ? cur.username : row.name;
					if (newDisplay !== cur.display_name || newUsername !== cur.username) {
						await tx`
              UPDATE "user"
              SET display_name = ${newDisplay},
                  normalized_display_name = ${normalizeNames(newDisplay)},
                  username = ${newUsername},
                  updated_at = NOW()
              WHERE id = ${row.discordId}
            `;
						report.updated++;
						if (opts.verbose) console.error(`[updated] ${row.discordId} ← ${row.name}`);
					} else {
						report.skipped++;
						if (opts.verbose) console.error(`[skipped] ${row.discordId} already up-to-date`);
					}
				} else {
					await tx`
            INSERT INTO "user" (id, created_at, updated_at, last_interact, role, username, display_name, normalized_display_name)
            VALUES (${row.discordId}, NOW(), NOW(), NOW(), 0, ${row.name}, ${row.name}, ${norm})
          `;
					report.created++;
					if (opts.verbose) console.error(`[created] ${row.discordId} ${row.name}`);
				}
			}

			if (opts.dryRun) {
				// Rollback explicite via throw — Bun.SQL begin() rollback on throw.
				throw new Error("__DRY_RUN_ROLLBACK__");
			}
		});
		if (opts.dryRun) {
			// Should not reach (rollback throws above)
		} else {
			console.error(`APPLIED — ${report.created} created, ${report.updated} updated`);
		}
	} catch (e) {
		if (e instanceof Error && e.message === "__DRY_RUN_ROLLBACK__") {
			console.error("DRY RUN — transaction rolled back (use --apply to write)");
		} else {
			throw e;
		}
	} finally {
		await sql.close();
	}

	return report;
}

// ===========================================================================
// Entry
// ===========================================================================

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const report = await runImport(opts);
	console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("FATAL:", err instanceof Error ? (err.stack ?? err.message) : err);
		process.exit(1);
	});
}
