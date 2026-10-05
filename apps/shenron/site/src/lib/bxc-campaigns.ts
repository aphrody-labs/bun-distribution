import "server-only";

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const CAMPAIGN_PREFIX = "dragonball-";
const CURRENT_CAMPAIGN_NAMES = new Set([
	"dragonball-official-unblocked-20260915",
	"dragonball-sources-full-20260915",
]);
const MEDIA_EXT = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const execFileAsync = promisify(execFile);

export type BxcCampaign = {
	id: string;
	label: string;
	group: "collection" | "sources" | "archive";
	state: "running" | "idle" | "unknown";
	updatedAt: Date | null;
	databaseBytes: number | null;
	pages: number | null;
	successfulPages: number | null;
	queuedPages: number | null;
	completedRequests: number | null;
	failedRequests: number | null;
};

export type BxcImportedRecord = {
	url: string;
	kind: string;
	title: string;
	httpStatus: number;
	fetchedAt: Date;
};

export type BxcHarvestAsset = {
	key: string;
	name: string;
	bytes: number;
	/** URL d'origine issue du `bxc recon`, jamais inférée depuis le nom local. */
	sourceUrl: string | null;
};

function bxcStateRoot(): string {
	return process.env.BXC_STATE_DIR || join(process.env.HOME || process.cwd(), ".bxc");
}

function campaignLabel(id: string): string {
	if (id.includes("official")) return "Collecte web — lot A";
	if (id.includes("sources")) return "Sources Dragon Ball";
	return id.replace(/^dragonball-/, "Dragon Ball · ").replaceAll("-", " ");
}

function campaignGroup(id: string): BxcCampaign["group"] {
	if (id.includes("official")) return "collection";
	if (id.includes("sources")) return "sources";
	return "archive";
}

function serviceForCampaign(id: string): string | null {
	if (id === "dragonball-official-unblocked-20260915") {
		return "shenron-bxc-dragonball-official-full.service";
	}
	if (id === "dragonball-sources-full-20260915") {
		return "shenron-bxc-dragonball-sources-full.service";
	}
	return null;
}

function databasePathForCampaign(id: string): string {
	return join(bxcStateRoot(), id, "bxc.sqlite");
}

function queuePathForCampaign(id: string): string | null {
	const queues: Record<string, string> = {
		"dragonball-official-unblocked-20260915": "dragonball-official-fast-20260915",
		"dragonball-sources-full-20260915": "dragonball-sources-full-20260915",
	};
	const queue = queues[id];
	return queue ? join(bxcStateRoot(), id, "storage", "request_queues", `${queue}.db`) : null;
}

async function isCampaignServiceActive(id: string): Promise<boolean> {
	const service = serviceForCampaign(id);
	if (!service) return false;
	try {
		await execFileAsync("systemctl", ["--user", "is-active", "--quiet", service], { timeout: 1_500 });
		return true;
	} catch {
		return false;
	}
}

function openSqliteReadOnly(path: string): {
	query: (sql: string) => { get: () => Record<string, unknown> | null };
	close: () => void;
} | null {
	try {
		if (typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined") {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { Database } = require("bun:sqlite");
			const db = new Database(path, { readonly: true });
			return {
				query: (sqlStr: string) => ({ get: () => db.query(sqlStr).get() }),
				close: () => db.close(),
			};
		}
		const nodeSqlite = (
			process as unknown as {
				getBuiltinModule?: (id: string) => {
					DatabaseSync: new (
						p: string,
						o?: unknown
					) => {
						prepare: (sqlStr: string) => { get: () => Record<string, unknown> | undefined };
						close: () => void;
					};
				};
			}
		).getBuiltinModule?.("node:sqlite");
		if (nodeSqlite) {
			const db = new nodeSqlite.DatabaseSync(path, { readOnly: true });
			return {
				query: (sqlStr: string) => ({
					get: () => (db.prepare(sqlStr).get() ?? null) as Record<string, unknown> | null,
				}),
				close: () => db.close(),
			};
		}
	} catch {
		return null;
	}
	return null;
}

function readCrawlCounters(path: string): { pages: number; successfulPages: number } | null {
	try {
		const database = openSqliteReadOnly(path);
		if (!database) return null;
		const row = database
			.query(
				"SELECT count(*) AS pages, sum(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS successfulPages FROM scrapes"
			)
			.get() as { pages?: number; successfulPages?: number } | null;
		database.close();
		return row ? { pages: Number(row.pages ?? 0), successfulPages: Number(row.successfulPages ?? 0) } : null;
	} catch {
		return null;
	}
}

function readQueueCounters(path: string | null): {
	queuedPages: number;
	completedRequests: number;
	failedRequests: number;
} | null {
	if (!path) return null;
	try {
		const database = openSqliteReadOnly(path);
		if (!database) return null;
		const row = database
			.query(
				"SELECT count(*) FILTER (WHERE state = 'PENDING') AS queuedPages, count(*) FILTER (WHERE state = 'DONE') AS completedRequests, count(*) FILTER (WHERE state = 'FAILED') AS failedRequests FROM requests"
			)
			.get() as { queuedPages?: number; completedRequests?: number; failedRequests?: number } | null;
		database.close();
		return row
			? {
					queuedPages: Number(row.queuedPages ?? 0),
					completedRequests: Number(row.completedRequests ?? 0),
					failedRequests: Number(row.failedRequests ?? 0),
				}
			: null;
	} catch {
		return null;
	}
}

/**
 * Expose les campagnes BXC comme un état d'exploitation, jamais comme une
 * preuve éditoriale. Les données ne deviennent publiques qu'après validation
 * puis ingestion dans les tables wiki/canon appropriées.
 */
export async function listBxcCampaigns(): Promise<BxcCampaign[]> {
	let entries: string[] = [];
	try {
		entries = await readdir(/* turbopackIgnore: true */ bxcStateRoot());
	} catch {
		return [];
	}

	const names = [...new Set([...CURRENT_CAMPAIGN_NAMES, ...entries.filter((name) => name.startsWith(CAMPAIGN_PREFIX))])]
		.toSorted((a, b) => Number(CURRENT_CAMPAIGN_NAMES.has(b)) - Number(CURRENT_CAMPAIGN_NAMES.has(a)) || b.localeCompare(a))
		.slice(0, 12);

	return Promise.all(
		names.map(async (id): Promise<BxcCampaign> => {
			try {
				const databasePath = databasePathForCampaign(id);
				const database = await stat(databasePath);
				const ageMs = Date.now() - database.mtimeMs;
				const serviceActive = await isCampaignServiceActive(id);
				const counters = readCrawlCounters(databasePath);
				const queue = readQueueCounters(queuePathForCampaign(id));
				return {
					id,
					label: campaignLabel(id),
					group: campaignGroup(id),
					// Les deux campagnes actuelles ont une unité systemd : son état est
					// la vérité. Les campagnes historiques gardent le repli mtime.
					state: serviceActive || ageMs < 5 * 60_000 ? "running" : "idle",
					updatedAt: database.mtime,
					databaseBytes: database.size,
					pages: counters?.pages ?? null,
					successfulPages: counters?.successfulPages ?? null,
					queuedPages: queue?.queuedPages ?? null,
					completedRequests: queue?.completedRequests ?? null,
					failedRequests: queue?.failedRequests ?? null,
				};
			} catch {
				return {
					id,
					label: campaignLabel(id),
					group: campaignGroup(id),
					state: "unknown",
					updatedAt: null,
					databaseBytes: null,
					pages: null,
					successfulPages: null,
					queuedPages: null,
					completedRequests: null,
					failedRequests: null,
				};
			}
		})
	);
}

export async function listRecentBxcImports(): Promise<BxcImportedRecord[]> {
	try {
		const result = await db.execute(sql`
			SELECT url, kind, title, http_status AS "httpStatus", fetched_at AS "fetchedAt"
			FROM public.external_source_records
			ORDER BY fetched_at DESC
			LIMIT 12
		`);
		return (result as unknown as BxcImportedRecord[]).map((record) => (Object.assign(record, { fetchedAt: new Date(record.fetchedAt) })));
	} catch {
		// L'import est asynchrone : une table absente ou une base momentanément
		// indisponible ne doit pas rendre le cockpit inutilisable.
		return [];
	}
}

export async function getBxcImportStats(): Promise<{ total: number; latestAt: Date | null }> {
	try {
		const result = await db.execute(sql`
			SELECT count(*)::int AS total, max(fetched_at) AS "latestAt"
			FROM public.external_source_records
		`);
		const row = (result as unknown as { total: number; latestAt: Date | string | null }[])[0];
		return { total: row?.total ?? 0, latestAt: row?.latestAt ? new Date(row.latestAt) : null };
	} catch {
		return { total: 0, latestAt: null };
	}
}

function harvestRoot(): string {
	// En développement et au runtime le cwd est `apps/shenron/site`; les tests/outils
	// peuvent en revanche démarrer à la racine du monorepo.
	const siteRoot = process.cwd().endsWith("/apps/shenron/site")
		? process.cwd()
		: join(process.cwd(), "apps", "site");
	return join(siteRoot, "shenron-media-masters", "bxc-harvest", "images");
}

function harvestedName(url: string): string | null {
	try {
		const name = basename(new URL(url).pathname).replace(/[^a-zA-Z0-9._-]+/g, "_");
		return name && name !== "_" ? name : null;
	} catch {
		return null;
	}
}

async function readHarvestProvenance(): Promise<Map<string, string>> {
	try {
		const raw = await readFile(join(harvestRoot(), "..", "brut", "dbofficial-fr", "recon.json"), "utf8");
		const parsed = JSON.parse(raw) as { assets?: Array<{ url?: unknown; type?: unknown }> };
		const origin = new Map<string, string>();
		for (const asset of parsed.assets ?? []) {
			if (typeof asset.url !== "string") continue;
			const name = harvestedName(asset.url);
			if (name) origin.set(name, asset.url);
		}
		return origin;
	} catch {
		return new Map();
	}
}

export async function listBxcHarvestAssets(): Promise<BxcHarvestAsset[]> {
	try {
		const root = harvestRoot();
		const [names, provenance] = await Promise.all([readdir(root), readHarvestProvenance()]);
		const assets = await Promise.all(
			names.filter((name) => MEDIA_EXT.test(name)).map(async (name) => ({
				key: basename(name),
				name,
				bytes: (await stat(join(root, name))).size,
				sourceUrl: provenance.get(name) ?? null,
			}))
		);
		return assets.toSorted((a, b) => b.bytes - a.bytes);
	} catch {
		return [];
	}
}

/** Chemin validé pour la route admin d'aperçu, sans traversée de répertoires. */
export async function getBxcHarvestAssetPath(key: string): Promise<string | null> {
	if (!key || basename(key) !== key || !MEDIA_EXT.test(key)) return null;
	const path = join(harvestRoot(), key);
	try {
		const file = await stat(path);
		return file.isFile() ? path : null;
	} catch {
		return null;
	}
}
