#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Continuous, source-scoped PostgreSQL editorial RAG sync to Aphrody. */
import postgres from "postgres";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PG_SOURCES, urlPostgres } from "./_rag-sources-pg";
import { syncSource, type SyncManifest, type SyncResult } from "./_rag-aphrody-sync";
import {
  CORPUS_DIR,
  corpusSourceId,
  isFandom,
  loadCorpusDocs,
  renderCorpusDocs,
  type CorpusDoc,
} from "./_rag-corpus-sources";
import { resolveEntity, type SourceChunk } from "./_rag-sources-pg";
import { requireScriptEmbeddingSpace } from "./lib/script-env";

const args = process.argv.slice(2);
const apply = args.includes("--appliquer");
const all = args.includes("--toutes");
const force = args.includes("--force") || args.includes("--reparer");
const list = args.includes("--liste");
const crawlOnly = args.includes("--corpus-crawl");
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const crawlDir = resolve(
  option("--crawl-dir") ??
    join(process.env.APHRODY_HOME?.trim() || join(homedir(), ".aphrody"), "workspaces/dbfr/crawl"),
);
const manifestPath = resolve(
  option("--manifest") ??
    join(
      process.env.APHRODY_HOME?.trim() || join(homedir(), ".aphrody"),
      "workspaces/dbfr/indexes/shenron-aphrody-sync-manifest.json",
    ),
);
const reportPath =
  option("--report") ??
  process.env.SHENRON_RAG_REPORT ??
  join(homedir(), ".aphrody/workspaces/dbfr/indexes/shenron-rag-latest.json");
const corpusGroups = new Map<string, SourceChunk[]>();
const crawlGroups = new Map<string, SourceChunk[]>();
const missingCorpora: string[] = [];
for (const [name, author] of [
  ["corpus.json", false],
  ["corpus-xv2.json", false],
  ["corpus-aphrody.json", true],
] as const) {
  const path = join(CORPUS_DIR, name);
  const docs = loadCorpusDocs(path);
  if (!docs) {
    missingCorpora.push(name);
    continue;
  }
  const rendered = renderCorpusDocs(docs, author);
  if (rendered.refusedFandom > 0)
    console.warn(`⚠ ${name}: ${rendered.refusedFandom} Fandom documents excluded`);
  for (const passage of rendered.passages) {
    const group = corpusGroups.get(passage.sourceId) ?? [];
    group.push(passage);
    corpusGroups.set(passage.sourceId, group);
  }
}
if (crawlOnly || all) {
  const crawlCorpusDir = join(crawlDir, "corpus");
  let names: string[] = [];
  try {
    names = (await readdir(crawlCorpusDir)).filter((name) => name.endsWith(".jsonl")).toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const name of names) {
    const path = join(crawlCorpusDir, name);
    const content = await readFile(path, "utf8");
    for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Invalid crawl corpus JSON at ${path}:${lineIndex + 1}`);
      }
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Invalid crawl corpus row at ${path}:${lineIndex + 1}`);
      const row = value as Partial<CorpusDoc> & { kind?: unknown; entity?: unknown };
      if (
        typeof row.id !== "string" ||
        !row.id.trim() ||
        typeof row.name !== "string" ||
        !row.name.trim() ||
        typeof row.url !== "string" ||
        typeof row.markdown !== "string" ||
        !row.markdown.trim()
      ) {
        throw new Error(`Incomplete crawl corpus row at ${path}:${lineIndex + 1}`);
      }
      const doc: CorpusDoc = {
        id: row.id,
        name: row.name,
        url: row.url,
        markdown: row.markdown,
        ...(typeof row.lang === "string" ? { lang: row.lang } : {}),
      };
      if (isFandom(doc)) continue;
      const source = corpusSourceId(doc.id);
      if (!/^[a-z0-9_]{1,64}$/.test(source))
        throw new Error(`Invalid crawl corpus source ID ${source}`);
      const rendered = renderCorpusDocs([doc]);
      const group = crawlGroups.get(source) ?? [];
      for (const passage of rendered.passages) {
        group.push({
          ...passage,
          kind: typeof row.kind === "string" ? row.kind : passage.kind,
          entity:
            typeof row.entity === "string" && row.entity.trim()
              ? row.entity
              : passage.entity || resolveEntity(doc.name),
        });
      }
      crawlGroups.set(source, group);
    }
  }
}
for (const [source, chunks] of crawlGroups) {
  corpusGroups.set(source, [...(corpusGroups.get(source) ?? []), ...chunks]);
}
const crawlSources = new Set(crawlGroups.keys());
const sources = [...new Set([...Object.keys(PG_SOURCES), ...corpusGroups.keys()])];
const targets = crawlOnly
  ? [...crawlSources]
  : all
    ? [...sources]
    : args.filter((arg) => !arg.startsWith("--"));

if (list) {
  console.log(`Sources resynchronisables :\n  ${sources.join("\n  ")}`);
  process.exit(0);
}
if (crawlOnly && !targets.length)
  throw new Error(`No crawl corpus exports found under ${join(crawlDir, "corpus")}`);
if (!targets.length || targets.some((source) => !sources.includes(source))) {
  throw new Error(
    `Usage: rag-sync-aphrody.ts <source|--toutes> [--appliquer] [--force] [--report=PATH]. Sources: ${sources.join(", ")}`,
  );
}

await mkdir(dirname(manifestPath), { recursive: true });
const lockPath = `${manifestPath}.lock`;
const lock = await open(lockPath, "wx", 0o600).catch(async (error) => {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  const owner = await readFile(lockPath, "utf8");
  const pid = Number(owner.split(" ")[0]);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("RAG sync lock has no valid owner");
  try {
    process.kill(pid, 0);
  } catch (cause) {
    if (
      (cause as NodeJS.ErrnoException).code === "ESRCH" &&
      (await readFile(lockPath, "utf8")) === owner
    ) {
      await unlink(lockPath);
      return open(lockPath, "wx", 0o600);
    }
    throw cause;
  }
  throw new Error(`Aphrody RAG sync is already running (pid ${pid})`);
});
await lock.writeFile(`${process.pid} ${new Date().toISOString()}\n`);

try {
  const manifest = await readFile(manifestPath, "utf8")
    .then((content) => JSON.parse(content) as SyncManifest)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, sources: {} } as SyncManifest;
      throw new Error("Aphrody RAG sync manifest is unreadable or invalid", { cause: error });
    });
  if (manifest.version !== 1 || !manifest.sources || typeof manifest.sources !== "object") {
    throw new Error("Aphrody RAG sync manifest has an unsupported schema");
  }
  if (all)
    for (const source of Object.keys(manifest.sources))
      if (!targets.includes(source)) targets.push(source);

  async function persistManifest(): Promise<void> {
    await mkdir(dirname(manifestPath), { recursive: true });
    const temp = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temp, manifestPath);
  }

  // Aphrody embeds in the index space of the contract (shenron-rag); a configuration
  // asking for another space is refused before any document is sent.
  if (apply) requireScriptEmbeddingSpace(process.env);
  const sql = crawlOnly ? null : postgres(await urlPostgres(), { max: 2, prepare: false });
  const client = apply ? new AphrodyComputeClient() : null;
  const results: SyncResult[] = [];
  let failed = false;
  try {
    if (client) await client.ragStats(); // A first preload starts from an empty, available index.
    for (const source of targets) {
      try {
        const chunks = [
          ...(!crawlOnly && PG_SOURCES[source] ? await PG_SOURCES[source]!(sql!) : []),
          ...(crawlOnly ? (crawlGroups.get(source) ?? []) : (corpusGroups.get(source) ?? [])),
        ];
        const { result, state } = await syncSource(
          client,
          source,
          chunks,
          manifest.sources[source],
          {
            apply,
            force,
            requireVectors: true,
            onProgress: (indexed, total) => {
              if (indexed % 100 === 0 || indexed === total)
                console.log(`… ${source}: ${indexed}/${total} indexed`);
            },
          },
        );
        results.push(result);
        console.log(
          `${result.unchanged ? "=" : apply ? "✓" : "→"} ${source}: ${result.rendered} rendered, ${result.indexed} indexed, ${result.retired} retired${result.unchanged ? " (unchanged)" : ""}`,
        );
        if (apply && state && state !== manifest.sources[source]) {
          manifest.sources[source] = state;
          await persistManifest();
        }
      } catch (error) {
        failed = true;
        console.error(`✗ ${source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await sql?.end();
  }
  if (reportPath) {
    const path = resolve(reportPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ schema: "shenron-aphrody-rag-sync/v1", generatedAt: new Date().toISOString(), mode: apply ? "apply" : "simulation", sources: results, missingCorpora, failed }, null, 2)}\n`,
    );
  }
  if (missingCorpora.length) console.warn(`⚠ RAG corpora absent: ${missingCorpora.join(", ")}`);
  console.log(
    `${apply ? "✓" : "→"} Aphrody RAG sync: ${results.length}/${targets.length} sources, ${results.reduce((n, r) => n + r.indexed, 0)} indexed, ${results.reduce((n, r) => n + r.retired, 0)} retired.`,
  );
  if (failed) process.exitCode = 1;
} finally {
  await lock.close();
  await unlink(lockPath);
}
