// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "./process.ts";
import type { Journal, Lib } from "./deps/sync.ts";

/** Repository-rooted file, process and JSON helpers shared by every update module. */
export class Ctx {
  constructor(
    readonly root: string,
    readonly apply: boolean,
    readonly json: boolean,
  ) {}
  read = (p: string) => readFileSync(join(this.root, p), "utf8");
  write(p: string, s: string) {
    mkdirSync(dirname(join(this.root, p)), { recursive: true });
    writeFileSync(join(this.root, p), s);
  }
  exists = (p: string) => existsSync(join(this.root, p));
  run(cmd: string, args: string[], opts: { inherit?: boolean } = {}) {
    return spawnSync(cmd, args, {
      cwd: this.root,
      encoding: "utf8",
      stdio: opts.inherit ? "inherit" : "pipe",
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  jsonFile<T>(p: string, fallback: T): T {
    return this.exists(p) ? (JSON.parse(this.read(p)) as T) : fallback;
  }
  watch = () =>
    this.jsonFile<{ libs: Lib[]; consumers: Record<string, { cargo?: string[]; bun?: string[] }> }>(
      "tools/config/deps/watch.json",
      { libs: [], consumers: {} },
    );
  journal = () => this.jsonFile<Journal>("tools/config/deps/journal.json", { seen: {}, runs: [] });
  saveJournal = (j: Journal) =>
    this.write("tools/config/deps/journal.json", `${JSON.stringify(j, null, 2)}\n`);
}
