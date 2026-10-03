// SPDX-License-Identifier: Apache-2.0
/** Durability and configuration of the real Shenron stack: PostgreSQL index, editorial PG and Redis. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createResilientRedis } from "@shenron/db/redis";
import { createSql } from "@shenron/db/sql";
import { loadLiveRagEnv, requireLiveRag } from "../src/testing/live-rag";

import { PG_SOURCES } from "../scripts/_rag-sources-pg";

loadLiveRagEnv();
type Sql = ReturnType<typeof createSql>;
let live: Awaited<ReturnType<typeof requireLiveRag>>;
let reportSources: Array<{ source: string; rendered: number }>;
let index: Sql;
let editorial: Sql;
let redis: ReturnType<typeof createResilientRedis>;

beforeAll(async () => {
  live = await requireLiveRag();
  const reportPath =
    process.env.SHENRON_RAG_REPORT ??
    join(homedir(), ".aphrody/workspaces/dbfr/indexes/shenron-rag-latest.json");
  reportSources = JSON.parse(readFileSync(reportPath, "utf8")).sources;
  index = createSql({
    applicationName: "shenron-storage-live-index",
    url: process.env.APHRODY_MCP_DATABASE_URL,
    max: 1,
  });
  editorial = createSql({ applicationName: "shenron-storage-live-editorial", max: 1 });
  redis = createResilientRedis({ name: "shenron-storage-live", url: process.env.REDIS_URL! });
}, 120_000);
afterAll(async () => {
  redis?.close();
  await Promise.all([index?.end(), editorial?.end()]);
});

/** Normalize RESP replies (flat array, array of pairs, Map or object) into a string map. */
function toMap(reply: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (reply instanceof Map) {
    for (const [k, v] of reply) out.set(String(k).toLowerCase(), String(v));
  } else if (Array.isArray(reply)) {
    const pairs = reply.every((item) => Array.isArray(item));
    if (pairs)
      for (const [k, v] of reply as unknown[][]) out.set(String(k).toLowerCase(), String(v));
    else
      for (let i = 0; i + 1 < reply.length; i += 2)
        out.set(String(reply[i]).toLowerCase(), String(reply[i + 1]));
  } else if (reply && typeof reply === "object") {
    for (const [k, v] of Object.entries(reply)) out.set(k.toLowerCase(), String(v));
  }
  return out;
}

function parseInfo(reply: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of String(reply).split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (line && !line.startsWith("#") && at > 0) out.set(line.slice(0, at), line.slice(at + 1));
  }
  return out;
}

describe("real PostgreSQL index storage", () => {
  test("RAG tables are permanent, in the private namespace, with expected types", async () => {
    const rows = await index<
      { name: string; persistence: string; schema: string; kind: string }[]
    >`SELECT c.relname AS name, c.relpersistence AS persistence, n.nspname AS schema, c.relkind AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = ANY (ARRAY[
        to_regclass('aphrody_rag_documents'), to_regclass('aphrody_shenron_vectors'),
        to_regclass('aphrody_rag_cache_state')]::oid[])`;
    expect(rows.map((r) => r.name).toSorted()).toEqual([
      "aphrody_rag_cache_state",
      "aphrody_rag_documents",
      "aphrody_shenron_vectors",
    ]);
    for (const row of rows) {
      expect(row.persistence).toBe("p");
      expect(row.kind).toBe("r");
    }
    const schemas = new Set(rows.map((r) => r.schema));
    expect(schemas.size).toBe(1);
    const [schema] = [...schemas];
    expect(["public", "pg_catalog", "information_schema"]).not.toContain(schema!);
    const indexes = await index<{ persistence: string }[]>`
      SELECT c.relpersistence AS persistence FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = ANY (ARRAY[to_regclass('aphrody_rag_documents'),
        to_regclass('aphrody_shenron_vectors')]::oid[])`;
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.every((i) => i.persistence === "p")).toBe(true);
  });

  test("search_path resolves to the private namespace and the role is restricted", async () => {
    const [info] = await index<
      {
        schema: string;
        path: string;
        superuser: boolean;
        createdb: boolean;
        createrole: boolean;
        doc_schema: string;
        public_acl: boolean;
      }[]
    >`SELECT current_schema() AS schema, current_setting('search_path') AS path,
        r.rolsuper AS superuser, r.rolcreatedb AS createdb, r.rolcreaterole AS createrole,
        (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.oid = to_regclass('aphrody_rag_documents')) AS doc_schema,
        coalesce((SELECT bool_or(a.grantee = 0) FROM pg_namespace n,
          LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
          WHERE n.nspname = current_schema()), false) AS public_acl
      FROM pg_roles r WHERE r.rolname = current_user`;
    expect(info).toBeDefined();
    expect(info!.schema).toBe(info!.doc_schema);
    expect(["public", "pg_catalog"]).not.toContain(info!.schema);
    const first = info!.path.split(",")[0]!.trim().replaceAll('"', "");
    expect(first).toBe(info!.schema);
    expect(info!.public_acl).toBe(false);
    expect(info!.superuser).toBe(false);
    expect(info!.createdb).toBe(false);
    expect(info!.createrole).toBe(false);
  });

  test("server durability settings are production-grade", async () => {
    const [s] = await index<{ fsync: string; fpw: string; sync: string }[]>`
      SELECT current_setting('fsync') AS fsync, current_setting('full_page_writes') AS fpw,
        current_setting('synchronous_commit') AS sync`;
    expect(s!.fsync).toBe("on");
    expect(s!.fpw).toBe("on");
    // Each accepted setting flushes local WAL; only `off` permits local crash loss.
    expect(["on", "local", "remote_write", "remote_apply"]).toContain(s!.sync);
  });

  test("pgvector is installed and E5 storage matches the preload report", async () => {
    const [ext] = await index<{ installed: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`;
    expect(ext!.installed).toBe(true);
    const [col] = await index<{ type: string }[]>`
      SELECT format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a
      WHERE a.attrelid = to_regclass('aphrody_shenron_vectors') AND a.attname = 'embedding'`;
    expect(col!.type).toBe("vector(384)");
    const [vec] = await index<{ total: string; current: string; models: string }[]>`
      SELECT count(*) AS total,
        count(*) FILTER (WHERE model = 'Xenova/multilingual-e5-small' AND vector_dims(embedding) = 384) AS current,
        count(DISTINCT model) AS models
      FROM aphrody_shenron_vectors v JOIN aphrody_rag_documents d ON d.id = v.document_id
      WHERE d.corpus = 'shenron' AND coalesce(d.metadata->>'visible','true') <> 'false'`;
    const expected = reportSources.reduce((sum, s) => sum + s.rendered, 0);
    expect(Number(vec!.models)).toBe(1);
    expect(Number(vec!.current)).toBe(Number(vec!.total));
    expect(Number(vec!.current)).toBe(expected);
    expect(live.stats.vectors).toBe(expected);
    const hnsw = await index<{ n: string }[]>`
      SELECT count(*) AS n FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'aphrody_shenron_vectors'
      AND indexname = 'aphrody_shenron_vectors_cosine' AND indexdef ILIKE '%hnsw%'
      AND indexdef ILIKE '%vector_cosine_ops%'`;
    expect(Number(hnsw[0]!.n)).toBe(1);
  });

  test("per-source index counts equal the private report counts", async () => {
    const rows = await index<{ source: string; count: string }[]>`
      SELECT d.metadata->>'originSourceId' AS source, count(*) AS count
      FROM aphrody_rag_documents d
      WHERE d.corpus = 'shenron' AND coalesce(d.metadata->>'visible','true') <> 'false' GROUP BY 1`;
    const counts = new Map(rows.map((r) => [r.source, Number(r.count)]));
    expect(counts.size).toBe(reportSources.length);
    for (const s of reportSources) expect(counts.get(s.source)).toBe(s.rendered);
  });
});

describe("real editorial PostgreSQL", () => {
  test("every editorial source present in the report has rows in its table", async () => {
    // These exceptions mirror the canonical PostgreSQL renderers; all other
    // source IDs name their bot-schema table directly. Missing tables must fail.
    const exceptions: Record<string, readonly [string, string]> = {
      canon_references: ["public", "canon_references"],
      wiki_pages: ["public", "WikiPage"],
      manga: ["bot", "db_manga_pages"],
      databooks: ["bot", "db_databooks"],
    };
    for (const source of Object.keys(PG_SOURCES)) {
      expect(reportSources.some((s) => s.source === source && s.rendered > 0)).toBe(true);
      const [schema, table] = exceptions[source] ?? ["bot", source];
      const [exists] = await editorial<{ ok: boolean }[]>`
        SELECT to_regclass(${`"${schema}"."${table}"`}) IS NOT NULL AS ok`;
      expect(exists!.ok).toBe(true);
      const [row] = await editorial<{ count: string }[]>`
        SELECT count(*) FROM ${editorial(schema!)}.${editorial(table!)}`;
      expect(Number(row!.count)).toBeGreaterThan(0);
    }
    const [characters] = await editorial<{ count: string }[]>`
      SELECT count(*) FROM db_characters WHERE coalesce(visible::int,1) <> 0`;
    expect(Number(characters!.count)).toBeGreaterThan(0);
  });
});

describe("real Redis durability", () => {
  test("answers PING and the isolated qualification key round-trips", async () => {
    expect(await redis.send("PING", [])).toBe("PONG");
    const key = `shenron:rag:qualification:${live.completedAt}`;
    const value = await redis.send("GET", [key]);
    expect(typeof value).toBe("string");
    expect(JSON.parse(value as string).generatedAt).toBe(live.completedAt);
  });

  test("RDB or AOF persistence is enabled and healthy", async () => {
    const save =
      toMap(await redis.send("CONFIG", ["GET", "save"]))
        .get("save")
        ?.trim() ?? "";
    const aof =
      toMap(await redis.send("CONFIG", ["GET", "appendonly"])).get("appendonly") === "yes";
    const info = parseInfo(await redis.send("INFO", ["persistence"]));
    const rdbEnabled = save.length > 0;
    expect(rdbEnabled || aof).toBe(true);
    expect(info.get("loading")).toBe("0");
    if (rdbEnabled) {
      expect(info.get("rdb_last_bgsave_status")).toBe("ok");
      const lastSave = Number(info.get("rdb_last_save_time"));
      expect(Number.isFinite(lastSave) && lastSave > 0).toBe(true);
      expect(lastSave * 1000).toBeLessThanOrEqual(Date.now() + 60_000);
    }
    if (aof) {
      expect(info.get("aof_enabled")).toBe("1");
      expect(info.get("aof_last_write_status")).toBe("ok");
      expect(info.get("aof_last_bgrewrite_status")).toBe("ok");
    }
  });
});
