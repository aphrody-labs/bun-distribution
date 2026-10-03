// SPDX-License-Identifier: Apache-2.0
/** Shared qualification boundary: real editorial SQL, E5 vectors and Redis. */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lastAssignment } from "@shenron/db/env";
import { createSql } from "@shenron/db/sql";
import { createResilientRedis } from "@shenron/db/redis";
import { AphrodyComputeClient, type AphrodyRagStats } from "../aphrody/compute";

export const EDITORIAL_RAG_SOURCES = [
  "db_characters",
  "db_wiki_sections",
  "db_character_variants",
  "db_planets",
  "db_races",
  "db_techniques",
  "db_transformations",
  "db_sagas",
  "db_arcs",
  "db_movies",
  "db_games",
  "db_episodes",
  "db_manga_volumes",
  "db_manga_chapters",
  "db_tools",
  "db_battles",
  "db_items",
  "db_dragons",
  "db_wishes",
  "db_timeline_events",
  "db_power_levels",
  "db_locations",
  "db_tournaments",
  "db_voice_actors",
  "db_soundtracks",
  "contributors",
  "media_works",
  "narrative_timelines",
  "narrative_events",
  "canon_references",
  "wiki_pages",
  "manga",
  "databooks",
  "aphrody",
] as const;

/** Read credentials from their existing private store; never return or print them. */
export function loadLiveRagEnv(): void {
  const path =
    process.env.SHENRON_RAG_ENV ?? join(homedir(), ".aphrody/private/shenron/ai-http.env");
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error("SHENRON_RAG_ENV must be private (0600)");
  const text = readFileSync(path, "utf8");
  const names = [...text.matchAll(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)].map(
    (match) => match[1]!,
  );
  for (const name of names) {
    const value = lastAssignment(text, name);
    if (process.env[name] === undefined && value !== undefined) process.env[name] = value;
  }
  if (process.env.RAG_BACKEND !== "aphrody")
    throw new Error("Live Shenron tests require RAG_BACKEND=aphrody");
  for (const name of ["DATABASE_URL", "APHRODY_MCP_DATABASE_URL", "REDIS_URL"]) {
    if (!process.env[name]?.trim()) throw new Error(`Live Shenron tests require ${name}`);
  }
}

interface SyncReport {
  schema: string;
  generatedAt: string;
  mode: string;
  failed: boolean;
  missingCorpora: string[];
  sources: Array<{ source: string; rendered: number; digest: string }>;
}

export interface LiveRag {
  client: AphrodyComputeClient;
  stats: AphrodyRagStats;
  completedAt: string;
}

/** Reject missing, partial or stale preload evidence before any test can pass. */
export async function requireLiveRag(): Promise<LiveRag> {
  loadLiveRagEnv();
  const reportPath =
    process.env.SHENRON_RAG_REPORT ??
    join(homedir(), ".aphrody/workspaces/dbfr/indexes/shenron-rag-latest.json");
  let report: SyncReport;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as SyncReport;
  } catch {
    throw new Error(
      "Full Shenron RAG preload has not completed; run rag:prepare or inspect shenron-rag-sync.service",
    );
  }
  const maxAge = Number(process.env.SHENRON_RAG_MAX_AGE_SECONDS ?? 3600) * 1000;
  const age = Date.now() - Date.parse(report.generatedAt);
  if (
    report.schema !== "shenron-aphrody-rag-sync/v1" ||
    report.mode !== "apply" ||
    report.failed ||
    !Number.isFinite(age) ||
    age < 0 ||
    !Number.isFinite(maxAge) ||
    maxAge <= 0 ||
    age > maxAge ||
    report.missingCorpora.length
  ) {
    throw new Error("Shenron RAG preload is incomplete or stale; run rag:prepare");
  }
  for (const source of EDITORIAL_RAG_SOURCES) {
    if (!report.sources.some((item) => item.source === source && item.rendered > 0)) {
      throw new Error(`Shenron RAG preload is missing ${source}; run rag:prepare`);
    }
  }
  const client = new AphrodyComputeClient();
  const editorial = createSql({ applicationName: "shenron-rag-live-editorial", max: 1 });
  const index = createSql({
    applicationName: "shenron-rag-live-index",
    url: process.env.APHRODY_MCP_DATABASE_URL,
    max: 1,
  });
  const redis = createResilientRedis({ name: "shenron-rag-live", url: process.env.REDIS_URL! });
  try {
    const [health, stats, characters, indexed, pong] = await Promise.all([
      client.health(),
      client.ragStats(),
      editorial<
        { count: string }[]
      >`SELECT count(*) FROM db_characters WHERE coalesce(visible::int,1) <> 0`,
      index<{ source: string; count: string; vectors: string }[]>`
				SELECT d.metadata->>'originSourceId' AS source, count(*) AS count,
				count(v.document_id) FILTER (WHERE v.model = 'Xenova/multilingual-e5-small' AND v.created_at >= d.updated_at) AS vectors
				FROM aphrody_rag_documents d LEFT JOIN aphrody_shenron_vectors v ON v.document_id=d.id
				WHERE d.corpus='shenron' AND coalesce(d.metadata->>'visible','true') <> 'false' GROUP BY 1`,
      redis.send("PING", []),
    ]);
    if (!health.rag || !stats.chunks || Number(characters[0]?.count) <= 0 || pong !== "PONG") {
      throw new Error("Real Shenron PostgreSQL/RAG/Redis services are unavailable");
    }
    for (const source of report.sources) {
      const live = indexed.find((row) => row.source === source.source);
      if (Number(live?.count) !== source.rendered || Number(live?.vectors) !== source.rendered) {
        throw new Error(`Shenron ${source.source}: preload or E5 vectors are incomplete`);
      }
    }
    const search = await client.ragSearchWithMode("Son Goku", 5, {
      sourceId: "db_characters",
      lang: "fr",
    });
    if (
      search.mode !== "hybrid" ||
      !search.results.length ||
      !search.results.every((hit) => hit.content?.trim())
    ) {
      throw new Error("Real Shenron hybrid retrieval is unavailable");
    }
    const key = `shenron:rag:qualification:${report.generatedAt}`;
    const payload = JSON.stringify({ generatedAt: report.generatedAt, chunks: stats.chunks });
    await redis.send("SET", [key, payload, "EX", "3600"]);
    if ((await redis.send("GET", [key])) !== payload)
      throw new Error("Real Shenron Redis round trip failed");
    return { client, stats, completedAt: report.generatedAt };
  } catch (error) {
    // Driver errors may carry private connection details; expose only the phase.
    if (error instanceof Error && /^(Shenron |Real Shenron )/.test(error.message)) throw error;
    throw new Error("Real Shenron qualification failed; inspect the private service logs");
  } finally {
    redis.close();
    await Promise.all([editorial.end(), index.end()]);
  }
}
