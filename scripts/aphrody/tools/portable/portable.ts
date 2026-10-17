#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Gathers what Aphrody needs outside its checkout into the git-ignored `.portable/` (tools/config/portable.json), so the
// checkout moves to a fresh WSL, the VPS or another disk, and puts it back on the new machine.
//
//   bun scripts/tools/portable/portable.ts plan                  sizes and actions, changes nothing
//   bun scripts/tools/portable/portable.ts save [--apply]        move/copy/dump into .portable/, symlinks left behind
//   bun scripts/tools/portable/portable.ts restore [--apply] [--force] [--system]
//                                                                $HOME symlinks into .portable/, copies back configs;
//                                                                --system also restores the root-owned trees
//   bun scripts/tools/portable/portable.ts status                MANIFEST.json summary
//
// Moved trees stay inside .portable/ after restore (the checkout carries its data); copies are restored in place.

import {
  cpSync,
  existsSync,
  lchownSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export type Mode = "move" | "copy";
export type Category = "essential" | "data" | "heavy";

export interface Item {
  path: string;
  mode: Mode;
  category: Category;
  exclude?: string[];
  heavy?: string[];
  root?: boolean;
  service?: string;
}

export interface Dump {
  name: string;
  category: Category;
  command: string[];
  when?: string[];
}

export interface PortableConfig {
  directory: string;
  home: Item[];
  system: Item[];
  dumps: Dump[];
}

export interface ManifestEntry {
  source: string;
  stored: string;
  mode: Mode;
  category: Category;
  bytes: number;
  heavy?: Record<string, number>;
  owner?: string;
}

export interface Manifest {
  schema: "aphrody.portable/1";
  savedAt: string;
  host: string;
  user: string;
  home: string;
  revision: string;
  entries: ManifestEntry[];
  dumps: { name: string; bytes: number }[];
  totals: Record<Category, number>;
}

const ROOT = resolve(import.meta.dir, "../../../../docs/aphrody");

/** Where an item lives inside the portable directory. */
export function storedPath(base: string, item: Item, kind: "home" | "system"): string {
  return kind === "home" ? join(base, "home", item.path) : join(base, "system", item.path.replace(/^\/+/, ""));
}

/** True when `link` is a symlink whose target is `target`. */
export function linksTo(link: string, target: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === resolve(target);
  } catch {
    return false;
  }
}

export function excluded(rel: string, exclude: string[] | undefined): boolean {
  if (!exclude?.length || rel === "") return false;
  return exclude.some(e => rel === e || rel.startsWith(`${e}/`));
}

/** Apparent size of a tree without following symlinks. */
export function treeBytes(path: string, exclude?: string[]): number {
  let total = 0;
  const walk = (abs: string, rel: string) => {
    if (excluded(rel, exclude)) return;
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      let names: string[] = [];
      try {
        names = readdirSync(abs);
      } catch {}
      for (const name of names) walk(join(abs, name), rel ? `${rel}/${name}` : name);
    } else {
      total += st.size;
    }
  };
  walk(path, "");
  return total;
}

export function totals(entries: Pick<ManifestEntry, "category" | "bytes" | "heavy">[]): Record<Category, number> {
  const out: Record<Category, number> = { essential: 0, data: 0, heavy: 0 };
  for (const e of entries) {
    const heavy = Object.values(e.heavy ?? {}).reduce((a, b) => a + b, 0);
    out[e.category] += e.bytes - heavy;
    out.heavy += heavy;
  }
  return out;
}

export const gib = (bytes: number) => `${(bytes / 2 ** 30).toFixed(2)} GiB`;

function sudoSelf(args: string[]): boolean {
  const r = Bun.spawnSync(["sudo", "-n", process.execPath, import.meta.path, ...args], {
    windowsHide: true,
    stdout: "inherit",
    stderr: "inherit",
  });
  return r.exitCode === 0;
}

function copyTree(src: string, dest: string, exclude?: string[]): void {
  mkdirSync(dirname(dest), { recursive: true });
  // cpSync stats an existing destination link and fails when it dangles: replace links outright.
  if (lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(dest);
  cpSync(src, dest, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: from => {
      const rel = relative(src, from);
      if (excluded(rel, exclude)) return false;
      try {
        const st = lstatSync(from);
        return !(st.isSocket() || st.isFIFO());
      } catch {
        return false;
      }
    },
  });
}

/** Numeric id of a user or group name (or the number itself). */
function idOf(name: string, file: string): number {
  if (/^\d+$/.test(name)) return Number(name);
  return Number(
    readFileSync(file, "utf8")
      .split("\n")
      .find(l => l.startsWith(`${name}:`))
      ?.split(":")[2] ?? 0,
  );
}

/** `chown -R` without following symlinks; `own` is uid:gid or user:group. */
function chownTree(path: string, own: string): void {
  const [u, g] = own.split(":") as [string, string];
  const uid = idOf(u, "/etc/passwd");
  const gid = idOf(g, "/etc/group");
  const walk = (p: string) => {
    lchownSync(p, uid, gid);
    if (lstatSync(p).isDirectory()) for (const name of readdirSync(p)) walk(join(p, name));
  };
  walk(path);
}

function serviceActive(name: string): boolean {
  return (
    Bun.spawnSync(["systemctl", "is-active", "--quiet", name], {
      windowsHide: true,
    }).exitCode === 0
  );
}

function owner(path: string): string | undefined {
  try {
    const st = lstatSync(path);
    return `${st.uid}:${st.gid}`;
  } catch {
    return undefined;
  }
}

async function loadConfig(): Promise<PortableConfig> {
  return Bun.file(join(ROOT, "tools/config/portable.json")).json();
}

function plan(config: PortableConfig): void {
  const base = join(ROOT, config.directory);
  const home = homedir();
  for (const [kind, items] of [
    ["home", config.home],
    ["system", config.system],
  ] as const) {
    for (const item of items) {
      const src = kind === "home" ? join(home, item.path) : item.path;
      const dest = storedPath(base, item, kind);
      const state = linksTo(src, dest) ? "saved" : existsSync(src) ? "pending" : "absent";
      const bytes =
        state === "pending" ? treeBytes(src, item.exclude) : state === "saved" ? treeBytes(dest, item.exclude) : 0;
      console.log(
        `${state.padEnd(8)} ${item.mode.padEnd(5)} ${item.category.padEnd(9)} ${gib(bytes).padStart(11)}  ${src}`,
      );
    }
  }
  for (const dump of config.dumps)
    console.log(`dump     -     ${dump.category.padEnd(9)} ${"".padStart(11)}  ${dump.name}`);
}

async function save(config: PortableConfig, apply: boolean): Promise<number> {
  const base = join(ROOT, config.directory);
  const home = homedir();
  if (!apply) {
    plan(config);
    console.log("\n(plan only; add --apply)");
    return 0;
  }
  let failures = 0;
  const entries: ManifestEntry[] = [];
  mkdirSync(join(base, "dumps"), { recursive: true });
  for (const item of config.home) {
    const src = join(home, item.path);
    const dest = storedPath(base, item, "home");
    try {
      if (item.mode === "move") {
        if (!linksTo(src, dest)) {
          if (!existsSync(src)) continue;
          if (existsSync(dest)) throw new Error(`${dest} already exists`);
          mkdirSync(dirname(dest), { recursive: true });
          renameSync(src, dest);
          symlinkSync(dest, src);
        }
      } else {
        if (!existsSync(src)) continue;
        // A fresh copy each save: stale or dangling entries from a previous save are not merged.
        rmSync(dest, { recursive: true, force: true });
        copyTree(src, dest, item.exclude);
      }
      const heavy = item.heavy ? Object.fromEntries(item.heavy.map(h => [h, treeBytes(join(dest, h))])) : undefined;
      entries.push({
        source: `~/${item.path}`,
        stored: relative(base, dest),
        mode: item.mode,
        category: item.category,
        bytes: treeBytes(dest, item.exclude),
        heavy,
      });
      console.log(`saved   ${item.mode.padEnd(5)} ~/${item.path}`);
    } catch (e) {
      failures++;
      console.error(`FAILED  ~/${item.path}: ${(e as Error).message}`);
    }
  }
  for (const item of config.system) {
    const dest = storedPath(base, item, "system");
    if (!existsSync(item.path)) continue;
    if (item.service && serviceActive(item.service)) {
      failures++;
      console.error(`FAILED  ${item.path}: stop ${item.service} first for a consistent copy`);
      continue;
    }
    // Parents are created here, as the user, so the root helper only writes the tree itself.
    mkdirSync(dirname(dest), { recursive: true });
    const ok = item.root
      ? sudoSelf(["_copy", item.path, dest, `${process.getuid?.()}:${process.getgid?.()}`])
      : (copyTree(item.path, dest), true);
    if (!ok) {
      failures++;
      console.error(`FAILED  ${item.path}`);
      continue;
    }
    entries.push({
      source: item.path,
      stored: relative(base, dest),
      mode: "copy",
      category: item.category,
      bytes: treeBytes(dest),
      owner: owner(item.path),
    });
    console.log(`saved   copy  ${item.path}`);
  }
  const dumps: Manifest["dumps"] = [];
  for (const dump of config.dumps) {
    if (
      dump.when &&
      new TextDecoder().decode(Bun.spawnSync(dump.when, { windowsHide: true, stderr: "ignore" }).stdout).trim() !==
        "true"
    )
      continue;
    const r = Bun.spawnSync(dump.command, {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (r.exitCode !== 0 && r.stdout.length === 0) {
      console.error(`skipped dump ${dump.name}: ${r.stderr.toString().trim().split("\n")[0] ?? "failed"}`);
      continue;
    }
    await Bun.write(join(base, "dumps", dump.name), r.stdout);
    dumps.push({ name: dump.name, bytes: r.stdout.length });
    console.log(`dumped  ${dump.name} (${gib(r.stdout.length)})`);
  }
  const manifest: Manifest = {
    schema: "aphrody.portable/1",
    savedAt: new Date().toISOString(),
    host: hostname(),
    user: userInfo().username,
    home,
    revision: Bun.spawnSync(["git", "-C", ROOT, "rev-parse", "HEAD"], {
      windowsHide: true,
    })
      .stdout.toString()
      .trim(),
    entries,
    dumps,
    totals: totals(entries),
  };
  writeFileSync(join(base, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\nessential ${gib(manifest.totals.essential)}  data ${gib(manifest.totals.data)}  heavy ${gib(manifest.totals.heavy)}`,
  );
  return failures ? 1 : 0;
}

async function restore(config: PortableConfig, apply: boolean, force: boolean, system: boolean): Promise<number> {
  const base = join(ROOT, config.directory);
  const home = homedir();
  let failures = 0;
  for (const item of config.home) {
    const src = join(home, item.path);
    const stored = storedPath(base, item, "home");
    if (!existsSync(stored)) continue;
    if (item.mode === "move") {
      if (linksTo(src, stored)) continue;
      if (lstatSync(src, { throwIfNoEntry: false }) && !force) {
        failures++;
        console.error(`exists  ~/${item.path} (use --force to replace it with the link)`);
        continue;
      }
      console.log(`link    ~/${item.path} -> ${stored}`);
      if (!apply) continue;
      mkdirSync(dirname(src), { recursive: true });
      if (existsSync(src)) renameSync(src, `${src}.before-portable-${Date.now()}`);
      symlinkSync(stored, src);
    } else {
      if (existsSync(src) && !force) continue;
      console.log(`copy    ~/${item.path}`);
      if (apply) copyTree(stored, src);
    }
  }
  if (system) {
    for (const item of config.system) {
      const stored = storedPath(base, item, "system");
      if (!existsSync(stored)) continue;
      console.log(`system  ${item.path}`);
      if (!apply) continue;
      if (item.service)
        Bun.spawnSync(["sudo", "-n", "systemctl", "stop", item.service], {
          windowsHide: true,
        });
      const own = item.path.startsWith("/var/lib/postgresql")
        ? "postgres:postgres"
        : item.path.startsWith("/var/lib/redis")
          ? "redis:redis"
          : "0:0";
      if (!(item.root ? sudoSelf(["_copy", stored, item.path, own]) : (copyTree(stored, item.path), true))) failures++;
    }
  }
  if (!apply) console.log("\n(plan only; add --apply)");
  console.log(
    `dumps in ${join(base, "dumps")}: apt (dpkg --set-selections < dpkg-selections.txt; apt-get dselect-upgrade), supabase.sql (psql -f), crontab.txt (crontab)`,
  );
  return failures ? 1 : 0;
}

async function status(config: PortableConfig): Promise<number> {
  const file = Bun.file(join(ROOT, config.directory, "MANIFEST.json"));
  if (!(await file.exists())) {
    console.log("no MANIFEST.json yet; run `save --apply`");
    return 1;
  }
  const m: Manifest = await file.json();
  console.log(`${m.savedAt} ${m.user}@${m.host} rev ${m.revision.slice(0, 12)}`);
  for (const e of m.entries)
    console.log(`${e.mode.padEnd(5)} ${e.category.padEnd(9)} ${gib(e.bytes).padStart(11)}  ${e.source}`);
  console.log(`essential ${gib(m.totals.essential)}  data ${gib(m.totals.data)}  heavy ${gib(m.totals.heavy)}`);
  return 0;
}

if (import.meta.main) {
  const [command, ...rest] = Bun.argv.slice(2);
  const flags = new Set(rest);
  if (command === "_copy") {
    // Root-side helper: copy a tree and hand it to uid:gid.
    const [src, dest, own] = rest as [string, string, string];
    copyTree(src, dest);
    chownTree(dest, own);
    process.exit(0);
  }
  const config = await loadConfig();
  switch (command) {
    case "plan":
      plan(config);
      break;
    case "save":
      process.exitCode = await save(config, flags.has("--apply"));
      break;
    case "restore":
      process.exitCode = await restore(config, flags.has("--apply"), flags.has("--force"), flags.has("--system"));
      break;
    case "status":
      process.exitCode = await status(config);
      break;
    default:
      console.error("usage: portable.ts plan | save [--apply] | restore [--apply] [--force] [--system] | status");
      process.exitCode = 64;
  }
}
