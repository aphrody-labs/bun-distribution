#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// The one vendor tool: `tools/config/vendor.json` is the registry (url, pinned ref, sparse set) and the fetched trees are
// git-ignored. Every fetch is shallow (depth 1), blobless and sparse, so only the pinned commit's needed paths are
// downloaded.
//
//   bun scripts/tools/vendor/fetch.ts list   [--json]
//   bun scripts/tools/vendor/fetch.ts fetch  [name..]   (default: all; no-op when the pin is already checked out)
//   bun scripts/tools/vendor/fetch.ts check  [name..]   (exit 1 when a tree is missing or off its pin)
//   bun scripts/tools/vendor/fetch.ts remove [name..]
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface VendorSource {
  name: string;
  path: string;
  url: string;
  upstream?: string;
  ref: string;
  /** Cone directories to check out; absent means the whole tree. */
  sparse?: string[];
  /** Also check out the files at the repository root (cone mode always does; kept explicit for readers). */
  rootFiles?: boolean;
  /** Script owning the sparse set of a tree too large for a cone. */
  sparseScript?: string;
}

const REPO = resolve(dirname(import.meta.path), "../../../../docs/aphrody");

export const loadSources = async (): Promise<VendorSource[]> =>
  (await Bun.file(join(REPO, "tools/config/vendor.json")).json()).sources;

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["/usr/bin/git", ...args], {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: r.exitCode === 0,
    out: r.stdout.toString().trim(),
    err: r.stderr.toString().trim(),
  };
};

const head = (dir: string) => (existsSync(join(dir, ".git")) ? git(dir, "rev-parse", "HEAD").out : "");

export function fetchSource(s: VendorSource): string {
  const dir = join(REPO, s.path);
  if (head(dir) === s.ref) return `ok      ${s.name} @ ${s.ref.slice(0, 9)}`;
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    for (const step of [
      ["init", "-q"],
      ["remote", "add", "origin", s.url],
    ]) {
      const r = git(dir, ...step);
      if (!r.ok) throw new Error(`${s.name}: git ${step[0]}: ${r.err}`);
    }
    git(dir, "config", "extensions.partialClone", "origin");
    git(dir, "config", "remote.origin.promisor", "true");
    git(dir, "config", "remote.origin.partialclonefilter", "blob:none");
  }
  // A sparse script owns its tree (a cone of the 2.1M-file icons repository hangs git): check out nothing, let it materialise.
  if (s.sparseScript) git(dir, "sparse-checkout", "set", "--no-cone", "!/*");
  else if (s.sparse) git(dir, "sparse-checkout", "set", "--cone", ...s.sparse);
  const f = git(dir, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", s.ref);
  if (!f.ok) throw new Error(`${s.name}: fetch ${s.ref}: ${f.err}`);
  const c = git(dir, "checkout", "-q", "--detach", "FETCH_HEAD");
  if (!c.ok) throw new Error(`${s.name}: checkout: ${c.err}`);
  if (s.sparseScript) {
    const r = Bun.spawnSync(["bun", join(REPO, s.sparseScript)], {
      windowsHide: true,
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (r.exitCode !== 0) throw new Error(`${s.name}: ${s.sparseScript}: ${r.stderr.toString().trim()}`);
  }
  return `fetched ${s.name} @ ${s.ref.slice(0, 9)}`;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd = "list", ...rest] = argv;
  const json = rest.includes("--json");
  const names = rest.filter(a => !a.startsWith("--"));
  const all = await loadSources();
  const picked = names.length ? all.filter(s => names.includes(s.name)) : all;
  if (names.length && picked.length !== names.length) {
    console.error(`unknown source: ${names.filter(n => !all.some(s => s.name === n)).join(", ")}`);
    return 2;
  }
  if (cmd === "list") {
    const rows = picked.map(s => ({
      name: s.name,
      path: s.path,
      ref: s.ref,
      state:
        head(join(REPO, s.path)) === s.ref ? "pinned" : existsSync(join(REPO, s.path, ".git")) ? "off-pin" : "absent",
    }));
    console.log(
      json
        ? JSON.stringify(rows, null, 2)
        : rows.map(r => `${r.state.padEnd(8)}${r.name.padEnd(26)}${r.path}`).join("\n"),
    );
    return 0;
  }
  if (cmd === "check") {
    const bad = picked.filter(s => head(join(REPO, s.path)) !== s.ref);
    for (const s of bad) console.error(`not at pin: ${s.name} (${s.path})`);
    return bad.length ? 1 : 0;
  }
  if (cmd === "remove") {
    for (const s of picked) rmSync(join(REPO, s.path), { recursive: true, force: true });
    return 0;
  }
  if (cmd === "fetch") {
    let failed = 0;
    for (const s of picked) {
      try {
        console.log(fetchSource(s));
      } catch (e) {
        failed++;
        console.error(`FAILED  ${(e as Error).message}`);
      }
    }
    return failed ? 1 : 0;
  }
  console.error(`unknown command: ${cmd}`);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
