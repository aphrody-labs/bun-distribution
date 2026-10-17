// The drop folder usr/var/inbox (inside the gitignored usr/ root): files the owner drops there are
// ingested once they stop growing, then removed; a file that fails moves to inbox/.rejected with
// the reason next to it. Uploads from the play.aphrody.app page land in inbox/.uploads first.
import { existsSync, mkdirSync, readdirSync, statSync, watch } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { type IngestOptions, type IngestResult, ingestPaths, ownedPaths, restrict } from "./store";

export function inboxDir(): string {
  const dir = ownedPaths().inbox;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    void restrict(dir, true).catch(() => {});
  }
  return dir;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function settled(path: string): Promise<boolean> {
  let size = -1;
  for (let i = 0; i < 30; i++) {
    if (!existsSync(path)) return false;
    const now = statSync(path).size;
    if (now === size) return true;
    size = now;
    await sleep(1000);
  }
  return true;
}

/** Ingests one inbox entry and clears it; failures are parked in .rejected with a note. */
export async function processInboxEntry(path: string, options: IngestOptions = {}): Promise<IngestResult[]> {
  const results = await ingestPaths([path], { ...options, via: options.via ?? "inbox" });
  const failed = results.filter((result) => result.error);
  if (failed.length && failed.length === results.length) {
    const rejected = join(inboxDir(), ".rejected");
    await mkdir(rejected, { recursive: true });
    await rename(path, join(rejected, basename(path))).catch(() => {});
    await Bun.write(join(rejected, `${basename(path)}.error.txt`), failed.map((item) => `${item.input}: ${item.error}`).join("\n"));
  } else {
    await rm(path, { recursive: true, force: true });
  }
  return results;
}

/** Processes what is in the inbox now; with `watch`, keeps watching and calls `report` per batch. */
export async function runInbox(
  options: IngestOptions & { watch?: boolean; report?: (results: IngestResult[]) => void } = {},
): Promise<IngestResult[]> {
  const dir = inboxDir();
  const all: IngestResult[] = [];
  const pending = new Set<string>();
  let busy = Promise.resolve();
  const take = (name: string) => {
    if (name.startsWith(".") || pending.has(name)) return;
    pending.add(name);
    busy = busy.then(async () => {
      const path = join(dir, name);
      try {
        if (await settled(path)) {
          const results = await processInboxEntry(path, options);
          all.push(...results);
          options.report?.(results);
        }
      } finally {
        pending.delete(name);
      }
    });
  };
  for (const name of readdirSync(dir)) take(name);
  await busy;
  if (!options.watch) return all;
  watch(dir, (_event, name) => {
    if (name && !name.includes("/") && !name.includes("\\")) take(name);
  });
  return new Promise(() => {});
}
