#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// windex: unified real-time index of Windows (NTFS MFT/USN + Bun fs, PE/Authenticode/catalog metadata) stored in
// PostgreSQL, cached in Redis, projected to NDJSON under <home>/windex and to the home RAG. See
// docs/operations/os/WINDEX.md. Results go to stdout as JSON, progress to stderr.
import { parseArgs } from "node:util";
import { cachedNode, cachedQuery, connectRedis } from "./cache.ts";
import { loadConfig, normalizeRoot, underRoot, type Config, type HashMode } from "./config.ts";
import { ps, up } from "./containers.ts";
import { driveDir, exportSnapshot } from "./ndjson.ts";
import { connect, migrate } from "./pg.ts";
import { catalogPass, scan } from "./pipeline.ts";
import { Pool } from "./pool.ts";
import { buildCards, indexCards, queryHome } from "./rag.ts";
import { loadApiSet, loadServices } from "./system.ts";

const USAGE = `windex <commande> [options]

  up                     génère les mots de passe, démarre PostgreSQL + Redis (compose), applique les migrations
  migrate                applique les migrations versionnées
  scan [--root R]        indexe R (défaut C:\\Windows\\System32) : --hash all|pe|none, --full, --no-catalog,
                         --export, --max-hash-mb N, --no-graph, --workers N
  catalog [--root R]     passe différée des signatures par catalogue
  system                 recharge le schéma ApiSet et les services/pilotes
  get <chemin>           fiche d'un chemin (Redis puis PostgreSQL)
  graph <chemin>         imports résolus et importateurs d'une image PE
  stats                  compteurs de l'index (requête mise en cache)
  rag [--no-index]       régénère les fiches RAG et lance aphrody home index
  ask <texte>            requête RAG (aphrody home query)
  export [--root R]      instantané NDJSON (défaut C:\\)
  status                 conteneurs, migrations, racines, point de reprise USN
  watch                  surveillance temps réel (journal USN, repli ReadDirectoryChangesW)
  probe [--dir D]        latence de propagation création/suppression

Options communes : --home <dir> (défaut $APHRODY_HOME ou ~/.aphrody)`;

const { values: opt, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    home: { type: "string" },
    root: { type: "string" },
    hash: { type: "string" },
    full: { type: "boolean", default: false },
    "no-catalog": { type: "boolean", default: false },
    "no-graph": { type: "boolean", default: false },
    "no-index": { type: "boolean", default: false },
    export: { type: "boolean", default: false },
    "max-hash-mb": { type: "string" },
    workers: { type: "string" },
    dir: { type: "string" },
    "poll-ms": { type: "string" },
    "rag-minutes": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const log = (msg: string) =>
  console.error(`[windex ${new Date().toLocaleTimeString("fr-FR")}] ${msg}`);
const out = (v: unknown) =>
  console.log(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));

function defaultsFor(root: string): { hash: HashMode; graph: boolean } {
  const inWindows = underRoot(root, `${root.slice(0, 2)}\\Windows`);
  return { hash: inWindows ? "all" : "pe", graph: inWindows };
}

async function withSql<T>(
  cfg: Config,
  fn: (sql: ReturnType<typeof connect>) => Promise<T>,
  max = 6,
): Promise<T> {
  const sql = connect(cfg, max);
  try {
    return await fn(sql);
  } finally {
    await sql.close();
  }
}

async function tryRedis(cfg: Config) {
  try {
    return await connectRedis(cfg);
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const [cmd, ...rest] = positionals;
  if (!cmd || opt.help) {
    console.error(USAGE);
    return cmd ? 0 : 2;
  }
  const cfg = loadConfig({
    home: opt.home,
    workers: opt.workers ? Number(opt.workers) : undefined,
  });
  switch (cmd) {
    case "up": {
      const r = await up(cfg);
      const m = await withSql(cfg, migrate);
      out({ generated: r.generated.length, migrations: m });
      return 0;
    }
    case "migrate":
      out(await withSql(cfg, migrate));
      return 0;
    case "scan": {
      const root = normalizeRoot(opt.root ?? "C:\\Windows\\System32");
      const d = defaultsFor(root);
      const hash = (opt.hash as HashMode | undefined) ?? d.hash;
      if (!["all", "pe", "none"].includes(hash)) throw new Error(`--hash invalide : ${hash}`);
      const pool = new Pool(cfg.workers);
      const redis = await tryRedis(cfg);
      try {
        const report = await withSql(cfg, async (sql) => {
          await migrate(sql);
          return await scan(
            cfg,
            sql,
            pool,
            {
              root,
              hash,
              graph: opt["no-graph"] ? false : d.graph,
              maxHashBytes: Number(opt["max-hash-mb"] ?? 1024) * 1024 * 1024,
              full: opt.full,
              catalog: !opt["no-catalog"],
              export: opt.export || undefined,
            },
            redis,
            log,
          );
        });
        out(report);
      } finally {
        pool.close();
        redis?.close();
      }
      return 0;
    }
    case "catalog": {
      const pool = new Pool(cfg.workers);
      try {
        out(
          await withSql(cfg, (sql) =>
            catalogPass(sql, pool, opt.root ? normalizeRoot(opt.root) : undefined, log),
          ),
        );
      } finally {
        pool.close();
      }
      return 0;
    }
    case "system":
      out(
        await withSql(cfg, async (sql) => ({
          apiset: await loadApiSet(sql),
          services: await loadServices(sql),
        })),
      );
      return 0;
    case "get": {
      if (!rest[0]) throw new Error("chemin manquant");
      const redis = await connectRedis(cfg);
      try {
        out(await withSql(cfg, (sql) => cachedNode(redis, sql, rest[0]!)));
      } finally {
        redis.close();
      }
      return 0;
    }
    case "graph": {
      if (!rest[0]) throw new Error("chemin manquant");
      out(await withSql(cfg, (sql) => peGraph(sql, rest[0]!)));
      return 0;
    }
    case "stats": {
      const redis = await connectRedis(cfg);
      try {
        out(await withSql(cfg, (sql) => cachedQuery(redis, "stats", () => stats(sql))));
      } finally {
        redis.close();
      }
      return 0;
    }
    case "rag": {
      const cards = await withSql(cfg, (sql) => buildCards(sql, cfg));
      log(
        `fiches : ${cards.cards} (${cards.written} écrites, ${cards.removed} retirées) en ${Math.round(cards.ms)} ms`,
      );
      const index = opt["no-index"] ? null : await indexCards(cfg, cards.dir);
      out({ cards, index });
      return index && index.code !== 0 ? 1 : 0;
    }
    case "ask": {
      const r = await queryHome(cfg, rest.join(" "));
      console.log(r.out);
      return r.code;
    }
    case "export": {
      const root = normalizeRoot(opt.root ?? "C:\\");
      out(await withSql(cfg, (sql) => exportSnapshot(sql, root, driveDir(cfg.dir, root))));
      return 0;
    }
    case "status": {
      const containers = await ps(cfg);
      const r = await withSql(cfg, async (sql) => ({
        migrations:
          await sql`SELECT version, name, applied_at FROM public.windex_schema_migrations ORDER BY version`,
        roots:
          await sql`SELECT path, hash_mode, graph, scanned_at, entries, files, pe_files, errors, duration_ms
          FROM windex.root ORDER BY path_lc`,
        volume:
          await sql`SELECT letter, serial, journal_id::text, next_usn::text, updated_at FROM windex.volume`,
      }));
      console.error(containers.trim());
      out(r);
      return 0;
    }
    case "watch": {
      const { watch } = await import("./watch.ts");
      await watch(cfg, {
        pollMs: Number(opt["poll-ms"] ?? 200),
        ragMinutes: Number(opt["rag-minutes"] ?? 30),
        log,
      });
      return 0;
    }
    case "probe": {
      const { probe } = await import("./watch.ts");
      out(await probe(cfg, opt.dir ?? "C:\\Windows\\Temp"));
      return 0;
    }
    default:
      console.error(USAGE);
      return 2;
  }
}

async function peGraph(sql: ReturnType<typeof connect>, path: string) {
  const [node] =
    await sql`SELECT f.id, f.path, p.kind, p.machine, p.signature, p.signer, p.file_version
    FROM windex.fs_node f JOIN windex.pe p ON p.node_id = f.id WHERE f.path_lc = ${path.replaceAll("/", "\\").toLowerCase()}`;
  if (!node) return null;
  const imports = await sql`SELECT e.label AS module, t.path AS resolved FROM windex.edge e
    JOIN windex.fs_node t ON t.id = e.dst WHERE e.src = ${node.id} AND e.kind = 'imports' ORDER BY e.label`;
  const unresolved = await sql`SELECT i.module FROM windex.pe_import i WHERE i.node_id = ${node.id}
    AND NOT EXISTS (SELECT 1 FROM windex.edge e WHERE e.src = i.node_id AND e.kind = 'imports' AND e.label = i.module)
    ORDER BY i.module`;
  const importers = await sql`SELECT s.path, e.label AS as_module FROM windex.edge e
    JOIN windex.fs_node s ON s.id = e.src WHERE e.dst = ${node.id} AND e.kind = 'imports' ORDER BY s.path`;
  const services =
    await sql`SELECT s.name, e.kind, e.label FROM windex.edge e JOIN windex.service s ON s.id = e.src
    WHERE e.dst = ${node.id} AND e.kind IN ('service', 'driver') ORDER BY s.name`;
  return {
    ...node,
    id: String(node.id),
    imports,
    unresolved: unresolved.map((r: { module: string }) => r.module),
    importers: { count: importers.length, sample: importers.slice(0, 25) },
    services,
  };
}

async function stats(sql: ReturnType<typeof connect>) {
  const [s] = await sql`SELECT
      (SELECT count(*)::int FROM windex.fs_node) AS nodes,
      (SELECT count(*)::int FROM windex.fs_node WHERE is_dir) AS dirs,
      (SELECT count(*)::int FROM windex.fs_node WHERE NOT is_dir) AS files,
      (SELECT count(*)::int FROM windex.fs_node WHERE sha256 IS NOT NULL) AS hashed,
      (SELECT count(*)::int FROM windex.pe) AS pe,
      (SELECT count(*)::int FROM windex.pe WHERE is_dotnet) AS dotnet,
      (SELECT count(*)::int FROM windex.service) AS services,
      (SELECT count(*)::int FROM windex.apiset) AS apiset,
      (SELECT count(*)::int FROM windex.symbol) AS symbols`;
  const pe =
    await sql`SELECT kind, signature, count(*)::int AS n FROM windex.pe GROUP BY 1, 2 ORDER BY 1, 2`;
  const edges =
    await sql`SELECT kind, count(*)::int AS n FROM windex.graph_edge GROUP BY 1 ORDER BY 1`;
  return { ...s, pe_by_kind: pe, edges };
}

try {
  process.exitCode = await main();
} catch (e) {
  log(`erreur : ${(e as Error).message}`);
  process.exitCode = 1;
}
