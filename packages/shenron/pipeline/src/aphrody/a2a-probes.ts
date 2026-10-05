// SPDX-License-Identifier: Apache-2.0
/**
 * a2a-probes.ts — Measured state for the A2A hub (no hardcoded status, ever).
 *
 * Each probe reads a real source and says "unknown" when it cannot:
 * - PostgreSQL `bot.db_databooks` (read-only aggregate over the `pages` jsonb) ;
 * - systemd unit state (`systemctl show`, no privilege needed) ;
 * - `~/.aphrody/ocr/results.db` health (`PRAGMA quick_check` on a read-only handle) ;
 * - OCR/GPU worker liveness, only from a fresh `.coord/heartbeat-<peer>.txt` ;
 * - the public RAG context endpoint (`/api/public/rag/context`).
 *
 * The hub consumes them through `A2AProbes` so tests can inject fakes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadDatabaseUrl } from "@shenron/db/env";
import { createSql } from "@shenron/db/sql";
import { requireAiHttpUrl } from "../ai/config";
import { buildSourcesBlock } from "../ai/prompts";
import { AphrodyComputeClient } from "./compute";

// ============================================================================
// Repository & configuration resolution
// ============================================================================

/** Walks up from `start` to the monorepo root (the dir holding `packages/aphrody` and `apps`). */
function walkUpToRepoRoot(start: string): string | null {
	let dir = path.resolve(start);
	for (let i = 0; i < 12; i++) {
		if (
			fs.existsSync(path.join(dir, "packages", "aphrody")) &&
			fs.existsSync(path.join(dir, "apps"))
		) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** Monorepo root, from the module location (Bun) then from the working directory. */
export function findRepoRoot(): string | null {
	const metaDir = (import.meta as { dir?: unknown }).dir;
	if (typeof metaDir === "string") {
		const fromModule = walkUpToRepoRoot(metaDir);
		if (fromModule) return fromModule;
	}
	return walkUpToRepoRoot(process.cwd());
}

/**
 * Shared coordination directory. `A2A_COORD_DIR` wins; otherwise the repo-root `.coord`
 * (the MCP runs from `apps/mcp`, which used to split the mailbox into `apps/mcp/.coord`).
 */
export function resolveCoordDir(): string {
	const fromEnv = process.env.A2A_COORD_DIR?.trim();
	if (fromEnv) return fromEnv;
	const root = findRepoRoot();
	return root ? path.join(root, ".coord") : path.resolve(process.cwd(), ".coord");
}

/**
 * Site database URL: `DATABASE_URL`, else the LAST active `DATABASE_URL=` line of
 * `apps/shenron/site/.env` (the file keeps a decommissioned URL, commented, above the live one).
 * Resolved by `loadDatabaseUrl` (validated, never logged).
 */
async function resolveDatabaseUrl(): Promise<string | null> {
	const root = findRepoRoot();
	const result = loadDatabaseUrl({
		fallbackFiles: root ? [{ path: path.join(root, "apps", "site", ".env") }] : [],
	});
	return result.ok ? result.url : null;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ============================================================================
// Probe result types
// ============================================================================

export interface TranslationWriterStat {
	writer: string;
	pages: number;
	latestAt: string | null;
}

export type DatabooksPipelineSnapshot =
	| {
			measured: true;
			measuredAt: string;
			pagesTotal: number;
			withText: number;
			withTextFr: number;
			/** Pages without any Japanese text yet (OCR backlog). */
			pendingOcr: number;
			/** Pages with Japanese text but no French translation (translation backlog). */
			pendingTranslation: number;
			latestTextFrAt: string | null;
			writers: TranslationWriterStat[];
	  }
	| { measured: false; measuredAt: string; error: string };

export type UnitActiveState =
	| "active"
	| "inactive"
	| "failed"
	| "activating"
	| "deactivating"
	| "not-found"
	| "unknown";

export interface UnitState {
	unit: string;
	state: UnitActiveState;
	subState?: string;
	since?: string;
	error?: string;
}

export interface OcrResultsDbState {
	path: string;
	state: "ok" | "corrupt" | "absent" | "unknown";
	bytes?: number;
	messages?: string[];
	pagesByStatus?: Record<string, number>;
	error?: string;
}

export interface HeartbeatState {
	state: "alive" | "stale" | "none";
	maxAgeMinutes: number;
	peer?: string;
	lastSeen?: string;
	ageMinutes?: number;
}

export interface RagSource {
	n: number;
	title: string;
	url: string;
	kind?: string;
	sourceId?: string;
	score?: number;
}

export type RagProbeResult =
	| { ok: true; endpoint: string; mode: string; context: string; sources: RagSource[] }
	| { ok: false; endpoint: string; error: string };

export interface A2AProbes {
	databooksPipeline(): Promise<DatabooksPipelineSnapshot>;
	systemdUnits(units: string[]): Promise<UnitState[]>;
	ocrResultsDb(): Promise<OcrResultsDbState>;
	ocrHeartbeat(coordDir: string): Promise<HeartbeatState>;
	ragContext(query: string, opts?: { limit?: number; maxChars?: number }): Promise<RagProbeResult>;
}

// ============================================================================
// Default (real) probes
// ============================================================================

const PIPELINE_CACHE_MS = 60_000;
let pipelineCache: { at: number; value: DatabooksPipelineSnapshot } | null = null;

/** Aggregate over `bot.db_databooks.pages` (visible books only). Read-only, cached 60 s. */
async function probeDatabooksPipeline(): Promise<DatabooksPipelineSnapshot> {
	if (pipelineCache && Date.now() - pipelineCache.at < PIPELINE_CACHE_MS) {
		return pipelineCache.value;
	}
	const measuredAt = new Date().toISOString();
	const url = await resolveDatabaseUrl();
	if (!url) {
		return {
			measured: false,
			measuredAt,
			error: "DATABASE_URL introuvable (env ou apps/shenron/site/.env)",
		};
	}

	const sql = createSql({
		url,
		max: 1,
		idleTimeoutSeconds: 5,
		connectTimeoutSeconds: 5,
		applicationName: "shenron-a2a-probes",
	});
	try {
		const [totals] = (await sql`
			WITH p AS (
				SELECT e.page
				FROM bot.db_databooks b,
					jsonb_array_elements(
						CASE WHEN jsonb_typeof(b.pages) = 'array' THEN b.pages ELSE '[]'::jsonb END
					) AS e(page)
				WHERE b.visible IS NOT FALSE
			), f AS (
				SELECT
					length(trim(coalesce(
						CASE WHEN jsonb_typeof(page->'text') = 'object' THEN page->'text'->>'markdown'
						ELSE page->>'text' END, ''))) > 0 AS has_text,
					length(trim(coalesce(
						CASE WHEN jsonb_typeof(page->'text_fr') = 'object' THEN page->'text_fr'->>'markdown'
						ELSE page->>'text_fr' END, ''))) > 0 AS has_fr
				FROM p
			)
			SELECT
				count(*)::int AS pages_total,
				count(*) FILTER (WHERE has_text)::int AS with_text,
				count(*) FILTER (WHERE has_fr)::int AS with_text_fr,
				count(*) FILTER (WHERE has_text AND NOT has_fr)::int AS pending_translation
			FROM f`) as Array<{
			pages_total: number;
			with_text: number;
			with_text_fr: number;
			pending_translation: number;
		}>;

		const writers = (await sql`
			WITH p AS (
				SELECT e.page
				FROM bot.db_databooks b,
					jsonb_array_elements(
						CASE WHEN jsonb_typeof(b.pages) = 'array' THEN b.pages ELSE '[]'::jsonb END
					) AS e(page)
				WHERE b.visible IS NOT FALSE
					AND coalesce(e.page->>'text_fr', '') <> ''
			)
			SELECT
				coalesce(nullif(page->>'text_fr_by', ''), '(non signé)') AS writer,
				count(*)::int AS pages,
				max(
					CASE
						WHEN page->>'text_fr_at' ~ '^[0-9]{12,}$'
							THEN to_timestamp((page->>'text_fr_at')::bigint / 1000.0)
						WHEN page->>'text_fr_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
							THEN (page->>'text_fr_at')::timestamptz
						ELSE NULL
					END
				) AS latest_at
			FROM p
			GROUP BY 1
			ORDER BY 2 DESC
			LIMIT 25`) as Array<{ writer: string; pages: number; latest_at: Date | string | null }>;

		const toIso = (v: Date | string | null): string | null =>
			v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
		const writerStats = writers.map((w) => ({
			writer: w.writer,
			pages: Number(w.pages),
			latestAt: toIso(w.latest_at),
		}));
		const latestTextFrAt =
			writerStats
				.map((w) => w.latestAt)
				.filter((v): v is string => Boolean(v))
				.toSorted()
				.pop() ?? null;

		const pagesTotal = Number(totals?.pages_total ?? 0);
		const withText = Number(totals?.with_text ?? 0);
		const value: DatabooksPipelineSnapshot = {
			measured: true,
			measuredAt,
			pagesTotal,
			withText,
			withTextFr: Number(totals?.with_text_fr ?? 0),
			pendingOcr: pagesTotal - withText,
			pendingTranslation: Number(totals?.pending_translation ?? 0),
			latestTextFrAt,
			writers: writerStats,
		};
		pipelineCache = { at: Date.now(), value };
		return value;
	} catch (err) {
		return { measured: false, measuredAt, error: `PostgreSQL : ${errorMessage(err)}` };
	} finally {
		await sql.end({ timeout: 5 }).catch(() => {});
	}
}

/** `systemctl show` for each unit; any failure yields `unknown` with the reason. */
async function probeSystemdUnits(units: string[]): Promise<UnitState[]> {
	const BunGlobal = (globalThis as { Bun?: { spawn?: (...args: any[]) => any } }).Bun;
	return Promise.all(
		units.map(async (unit): Promise<UnitState> => {
			if (!BunGlobal?.spawn) return { unit, state: "unknown", error: "Bun.spawn indisponible" };
			try {
				const proc = BunGlobal.spawn(
					[
						"systemctl",
						"show",
						unit,
						"--property=LoadState,ActiveState,SubState,StateChangeTimestamp",
					],
					{ stdout: "pipe", stderr: "pipe" }
				);
				const timer = setTimeout(() => proc.kill(), 3000);
				const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
				clearTimeout(timer);
				if (code !== 0) return { unit, state: "unknown", error: `systemctl exit ${code}` };
				const props = Object.fromEntries(
					out
						.split("\n")
						.filter((l) => l.includes("="))
						.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
				) as Record<string, string>;
				if (props.LoadState === "not-found") return { unit, state: "not-found" };
				const known: UnitActiveState[] = [
					"active",
					"inactive",
					"failed",
					"activating",
					"deactivating",
				];
				const state = known.includes(props.ActiveState as UnitActiveState)
					? (props.ActiveState as UnitActiveState)
					: "unknown";
				return {
					unit,
					state,
					subState: props.SubState || undefined,
					since: props.StateChangeTimestamp || undefined,
				};
			} catch (err) {
				return { unit, state: "unknown", error: errorMessage(err) };
			}
		})
	);
}

/** Size above which a synchronous quick_check could stall the server event loop. */
const RESULTS_DB_MAX_CHECK_BYTES = 256 * 1024 * 1024;

/** Health of the Aphrody OCR corpus, checked read-only. */
async function probeOcrResultsDb(): Promise<OcrResultsDbState> {
	const dbPath =
		process.env.OCR_RESULTS_DB || path.join(os.homedir(), ".aphrody", "ocr", "results.db");
	if (!fs.existsSync(/* turbopackIgnore: true */ dbPath)) return { path: dbPath, state: "absent" };
	let bytes = 0;
	try {
		bytes = fs.statSync(/* turbopackIgnore: true */ dbPath).size;
		const fd = fs.openSync(/* turbopackIgnore: true */ dbPath, "r");
		try {
			const header = Buffer.alloc(16);
			const n = fs.readSync(fd, header, 0, 16, 0);
			if (n !== 16 || header.toString("latin1") !== "SQLite format 3 ") {
				return { path: dbPath, state: "corrupt", bytes, messages: ["en-tête SQLite absent"] };
			}
		} finally {
			fs.closeSync(fd);
		}
	} catch (err) {
		return { path: dbPath, state: "unknown", bytes, error: errorMessage(err) };
	}
	if (bytes > RESULTS_DB_MAX_CHECK_BYTES) {
		return {
			path: dbPath,
			state: "unknown",
			bytes,
			error: "fichier trop volumineux pour un quick_check synchrone",
		};
	}

	let db: { prepare(sql: string): { all(): unknown[] }; close(): void } | null = null;
	try {
		// node:sqlite (Bun and Node): keeps the `server` runtime class free of bun:* modules.
		const { DatabaseSync } = await import("node:sqlite");
		db = new DatabaseSync(dbPath, { readOnly: true });
		const messages = (db.prepare("PRAGMA quick_check(5)").all() as Array<Record<string, string>>).map(
			(r) => String(Object.values(r)[0])
		);
		if (!(messages.length === 1 && messages[0] === "ok")) {
			return { path: dbPath, state: "corrupt", bytes, messages };
		}
		let pagesByStatus: Record<string, number> | undefined;
		try {
			const rows = db
				.prepare("SELECT coalesce(status, '(null)') AS status, count(*) AS n FROM ocr_pages GROUP BY 1")
				.all() as Array<{ status: string; n: number }>;
			pagesByStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
		} catch {
			// Schema without ocr_pages.status: health is still measured, the breakdown is not.
		}
		return { path: dbPath, state: "ok", bytes, messages, pagesByStatus };
	} catch (err) {
		const msg = errorMessage(err);
		const corrupt = /malformed|not a database|corrupt|disk image/i.test(msg);
		return { path: dbPath, state: corrupt ? "corrupt" : "unknown", bytes, error: msg };
	} finally {
		try {
			db?.close();
		} catch {}
	}
}

/** Peers whose heartbeat proves an OCR / GPU worker is alive. */
const OCR_PEER_PATTERN = /ocr|gpu|rtx|local[_-]?model|vision/i;
const HEARTBEAT_MAX_AGE_MINUTES = 15;

/** Freshest OCR/GPU heartbeat in `.coord` (content = ISO date, else file mtime). */
async function probeOcrHeartbeat(coordDir: string): Promise<HeartbeatState> {
	const base: HeartbeatState = { state: "none", maxAgeMinutes: HEARTBEAT_MAX_AGE_MINUTES };
	let files: string[] = [];
	try {
		files = fs
			.readdirSync(coordDir)
			.filter((f) => /^heartbeat-.+\.txt$/.test(f))
			.filter((f) => OCR_PEER_PATTERN.test(f.slice("heartbeat-".length, -".txt".length)));
	} catch {
		return base;
	}
	let best: { peer: string; at: number } | null = null;
	for (const file of files) {
		const full = path.join(coordDir, file);
		try {
			const content = fs.readFileSync(full, "utf8").trim();
			const parsed = Date.parse(content);
			const at = Number.isFinite(parsed) ? parsed : fs.statSync(full).mtimeMs;
			const peer = file.slice("heartbeat-".length, -".txt".length);
			if (!best || at > best.at) best = { peer, at };
		} catch {}
	}
	if (!best) return base;
	const ageMinutes = Math.round(((Date.now() - best.at) / 60_000) * 10) / 10;
	return {
		state: ageMinutes <= HEARTBEAT_MAX_AGE_MINUTES ? "alive" : "stale",
		maxAgeMinutes: HEARTBEAT_MAX_AGE_MINUTES,
		peer: best.peer,
		lastSeen: new Date(best.at).toISOString(),
		ageMinutes,
	};
}

/** Real RAG search through the configured shared backend or bot public API. */
async function probeRagContext(
	query: string,
	opts: { limit?: number; maxChars?: number } = {}
): Promise<RagProbeResult> {
	const apiBase = (process.env.SHENRON_API_URL ?? "http://127.0.0.1:5006").replace(/\/$/, "");
	const siteBase = (process.env.SHENRON_SITE_URL ?? "https://dragonballfr.com").replace(/\/$/, "");
	const limit = Math.min(Math.max(opts.limit ?? 5, 1), 12);
	const maxChars = Math.min(Math.max(opts.maxChars ?? 4000, 500), 16_000);
	if (process.env.RAG_BACKEND === "aphrody") {
		let endpoint = "/api/v1/shenron/rag/search";
		try {
			endpoint = new URL(endpoint, requireAiHttpUrl(process.env)).href;
			const { results, mode } = await new AphrodyComputeClient().ragSearchWithMode(query, limit);
			const seen = new Set<string>();
			const passages = results.filter((hit) => {
				if (seen.has(hit.url)) return false;
				seen.add(hit.url);
				return true;
			});
			const sources = passages.map((hit, index) => ({
				n: index + 1,
				title: hit.title,
				url: new URL(hit.url, siteBase).href,
				kind: hit.kind,
				sourceId: hit.sourceId,
				score: hit.score,
			}));
			const context = buildSourcesBlock(
				passages.map((hit, index) => ({
					title: hit.title,
					url: sources[index]!.url,
					text: hit.content ?? hit.snippet,
				})),
				{ perHit: Math.min(2000, maxChars), total: maxChars },
			).slice(0, maxChars);
			return { ok: true, endpoint, mode, context, sources };
		} catch {
			// Never project private request configuration or driver errors into A2A.
			return { ok: false, endpoint, error: "Shenron shared RAG request failed" };
		}
	}
	const endpoint = `${apiBase}/api/public/rag/context?q=${encodeURIComponent(query)}&limit=${limit}&maxChars=${maxChars}`;
	try {
		const res = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
		if (!res.ok) return { ok: false, endpoint, error: `HTTP ${res.status}` };
		const body = (await res.json()) as {
			mode?: string;
			context?: string;
			sources?: Array<Partial<RagSource>>;
			error?: string;
		};
		if (body.error) return { ok: false, endpoint, error: body.error };
		const sources: RagSource[] = (body.sources ?? [])
			.filter((s) => typeof s.url === "string" && typeof s.title === "string")
			.map((s, i) => ({
				n: typeof s.n === "number" ? s.n : i + 1,
				title: s.title as string,
				url: /^https?:\/\//.test(s.url as string)
					? (s.url as string)
					: `${siteBase}${(s.url as string).startsWith("/") ? "" : "/"}${s.url}`,
				kind: s.kind,
				sourceId: s.sourceId,
				score: s.score,
			}));
		return { ok: true, endpoint, mode: body.mode ?? "unknown", context: body.context ?? "", sources };
	} catch (err) {
		return { ok: false, endpoint, error: errorMessage(err) };
	}
}

export const defaultA2AProbes: A2AProbes = {
	databooksPipeline: probeDatabooksPipeline,
	systemdUnits: probeSystemdUnits,
	ocrResultsDb: probeOcrResultsDb,
	ocrHeartbeat: probeOcrHeartbeat,
	ragContext: probeRagContext,
};
