// SPDX-License-Identifier: Apache-2.0
import { mkdir, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  collect,
  passage,
  type Entry,
  type Snapshot,
  type TimelineSource,
  type TrainingOptions,
} from "./model.ts";
import { sqliteExport, sqlExport, redisIndex } from "./storage.ts";
import { SDL, query } from "./graphql.ts";
import { crawlDetails } from "./crawl.ts";
import { trainingArtifacts } from "./training.ts";

export interface RefreshOptions {
  redisUrl?: string;
  redisNamespace?: string;
  crawlBudget?: number;
  source?: TimelineSource;
  training?: TrainingOptions;
  /** Existing application indexer; the library never spawns a CLI or selects a domain home. */
  indexDocuments?: (directory: string, snapshot: Snapshot) => Promise<unknown>;
}

export async function refresh(output: string, options: RefreshOptions = {}) {
  output = resolve(output);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const lock = join(output, "running");
  await mkdir(lock, { mode: 0o700 });
  try {
    await Bun.write(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    const snapshot = await collect(fetch, options.source);
    const crawl = options.crawlBudget
      ? await crawlDetails(snapshot, output, options.crawlBudget)
      : null;
    const dir = join(output, "generations", snapshot.generation);
    await mkdir(join(dir, "documents"), { recursive: true, mode: 0o700 });
    await Bun.write(join(dir, "timeline.json.tmp"), JSON.stringify(snapshot, null, 2));
    await rename(join(dir, "timeline.json.tmp"), join(dir, "timeline.json"));
    await Bun.write(join(dir, "timeline.sql"), sqlExport(snapshot));
    sqliteExport(snapshot, join(dir, "timeline.sqlite"));
    await Bun.write(join(dir, "timeline.graphql"), SDL);
    const content = (entry: Entry) =>
      passage(entry, snapshot.source) +
      (crawl?.state.entries[entry.key]?.text
        ? `\n## Fiche source\n${crawl.state.entries[entry.key]!.text}\n`
        : "");
    await Promise.all(
      snapshot.entries.map((e) =>
        Bun.write(join(dir, "documents", e.key.replace(":", "-") + ".md"), content(e)),
      ),
    );
    const training = trainingArtifacts(snapshot, { content, ...options.training });
    const rows = training.examples;
    await mkdir(join(dir, "prepared"), { recursive: true, mode: 0o700 });
    await Promise.all([
      Bun.write(join(dir, "prepared", "rollouts.jsonl"), training.rolloutJsonl),
      Bun.write(join(dir, "gold.jsonl"), training.goldJsonl),
      Bun.write(join(dir, "training.json"), JSON.stringify(training.manifest, null, 2)),
    ]);
    await Promise.all(
      ["train", "eval"].map((split) =>
        Bun.write(
          join(dir, `${split}.jsonl`),
          rows
            .filter((r) => r.split === split)
            .map((r) => JSON.stringify(r))
            .join("\n") + "\n",
        ),
      ),
    );
    const check = await query(snapshot, "{ timeline { mediaTotal ageTotal entries { key } } }");
    if (check.errors) throw new Error("GraphQL projection failed validation");
    let index: unknown = null;
    if (options.indexDocuments)
      index = await options.indexDocuments(join(dir, "documents"), snapshot);
    if (options.redisUrl) await redisIndex(snapshot, options.redisUrl, options.redisNamespace);
    const report = {
      generation: snapshot.generation,
      mediaTotal: snapshot.mediaTotal,
      ageTotal: snapshot.ageTotal,
      train: rows.filter((r) => r.split === "train").length,
      eval: rows.filter((r) => r.split === "eval").length,
      redisIndexed: !!options.redisUrl,
      index,
      fetchedAt: snapshot.fetchedAt,
      trainingPerformed: false,
      trainingArtifacts: training.manifest,
      crawl: crawl
        ? {
            checked: crawl.checked,
            failed: crawl.failed,
            known: Object.keys(crawl.state.entries).length,
          }
        : null,
    };
    await Bun.write(join(dir, "report.json"), JSON.stringify(report, null, 2));
    await Bun.write(
      join(output, "current.json.tmp"),
      JSON.stringify({ generation: snapshot.generation, dir }),
    );
    await rename(join(output, "current.json.tmp"), join(output, "current.json"));
    return report;
  } finally {
    await rm(lock, { recursive: true });
  }
}

export async function load(output: string): Promise<Snapshot> {
  const current = await Bun.file(join(output, "current.json")).json();
  if (!/^[a-f0-9]{64}$/.test(current.generation)) throw new Error("invalid generation");
  return Bun.file(join(output, "generations", current.generation, "timeline.json")).json();
}
