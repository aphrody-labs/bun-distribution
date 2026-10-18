#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * One release entry point for every Bun OS product: quality gates, the npm packages and the crates.io crates.
 * Every stage is idempotent and resumable: a version that is already published is skipped, so a failed or
 * rate-limited run is repeated with the same command. Nothing is published without `--apply`.
 *
 *   bun scripts/release.ts verify                     # check, lint, format, docs, manifests
 *   bun scripts/release.ts plan                       # what npm and crates.io still miss
 *   bun scripts/release.ts npm    [--apply] [--only a,b]
 *   bun scripts/release.ts crates [--apply] [--only a,b] [--limit N]
 *   bun scripts/release.ts all    [--apply]           # verify, npm, crates
 *
 * Credentials come from the environment only: NPM_CONFIG_TOKEN (or an .npmrc) and CARGO_REGISTRY_TOKEN.
 */
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dir, "..");
const USER_AGENT = "aphrody-release (contact@aphrody.com)";
/** npm scopes the release token can publish to; imported scopes such as @storyteller belong to others. */
const OWNED_SCOPES = new Set((process.env.RELEASE_NPM_SCOPES ?? "@aphrody,@rosegriffon").split(","));

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    apply: { type: "boolean", default: false },
    only: { type: "string" },
    limit: { type: "string" },
    pause: { type: "string", default: "0" },
  },
});
const stage = positionals[0] ?? "plan";
const only = values.only ? new Set(values.only.split(",")) : undefined;
const apply = values.apply === true;

type NpmPackage = { name: string; version: string; dir: string; deps: string[] };
type Crate = { name: string; version: string; manifest: string; deps: string[] };

async function run(cmd: string[], cwd = ROOT): Promise<number> {
  console.log(`$ ${cmd.join(" ")}`);
  return await Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" }).exited;
}

async function capture(cmd: string[], cwd = ROOT): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
  return out;
}

/** Dependencies first, so every internal dependency is already published when its dependent is. */
export function order<T extends { name: string; deps: string[] }>(items: T[]): T[] {
  const byName = new Map(items.map(item => [item.name, item]));
  const done = new Set<string>();
  const sorted: T[] = [];
  const visit = (item: T, trail: Set<string>) => {
    if (done.has(item.name) || trail.has(item.name)) return;
    trail.add(item.name);
    for (const dep of item.deps) {
      const target = byName.get(dep);
      if (target) visit(target, trail);
    }
    done.add(item.name);
    sorted.push(item);
  };
  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) visit(item, new Set());
  return sorted;
}

export async function npmPackages(): Promise<NpmPackage[]> {
  const found: NpmPackage[] = [];
  for (const file of new Bun.Glob("{packages,apps}/*/package.json").scanSync({ cwd: ROOT })) {
    const manifest = await Bun.file(join(ROOT, file)).json();
    if (!manifest.name || !manifest.version || manifest.private) continue;
    if (!OWNED_SCOPES.has(manifest.name.split("/")[0])) continue;
    const deps = Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    });
    found.push({ name: manifest.name, version: manifest.version, dir: dirname(join(ROOT, file)), deps });
  }
  return order(found);
}

async function npmPublished(name: string, version: string): Promise<boolean> {
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`npm ${name}@${version}: HTTP ${res.status}`);
  return true;
}

export async function cargoCrates(): Promise<Crate[]> {
  const metadata = JSON.parse(await capture(["cargo", "metadata", "--format-version", "1", "--no-deps", "--locked"]));
  const crates: Crate[] = metadata.packages
    .filter((pkg: any) => !(Array.isArray(pkg.publish) && pkg.publish.length === 0))
    .map((pkg: any) => ({
      name: pkg.name,
      version: pkg.version,
      manifest: pkg.manifest_path,
      deps: pkg.dependencies.filter((dep: any) => dep.path).map((dep: any) => dep.name),
    }));
  return order(crates);
}

async function cratePublished(name: string, version: string): Promise<boolean> {
  const res = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`crates.io ${name}@${version}: HTTP ${res.status}`);
  return true;
}

async function missing<T extends { name: string; version: string }>(
  items: T[],
  published: (name: string, version: string) => Promise<boolean>,
): Promise<T[]> {
  const out: T[] = [];
  for (const item of items) {
    if (only && !only.has(item.name)) continue;
    if (!(await published(item.name, item.version))) out.push(item);
  }
  return out;
}

async function verify(): Promise<void> {
  for (const script of ["check", "lint", "format:check", "docs:check"]) {
    if ((await run(["bun", "run", script])) !== 0) throw new Error(`quality gate failed: ${script}`);
  }
  if ((await run(["bun", "scripts/workspace-manifests.ts"])) !== 0) throw new Error("workspace manifests differ");
}

async function plan(): Promise<void> {
  const [npm, crates] = await Promise.all([npmPackages(), cargoCrates()]);
  const [npmTodo, cratesTodo] = [await missing(npm, npmPublished), await missing(crates, cratePublished)];
  console.log(`npm: ${npmTodo.length} of ${npm.length} unpublished`);
  console.log(`crates.io: ${cratesTodo.length} of ${crates.length} unpublished`);
}

async function publishNpm(): Promise<void> {
  const todo = await missing(await npmPackages(), npmPublished);
  const failed: string[] = [];
  for (const pkg of todo) {
    const cmd = ["bun", "publish", "--access", "public", ...(apply ? [] : ["--dry-run"])];
    if ((await run(cmd, pkg.dir)) !== 0) failed.push(`${pkg.name}@${pkg.version}`);
  }
  console.log(`npm: ${todo.length - failed.length}/${todo.length} ${apply ? "published" : "verified"}`);
  if (failed.length) throw new Error(`npm failed: ${failed.join(", ")}`);
}

async function publishCrates(): Promise<void> {
  const limit = values.limit ? Number(values.limit) : Infinity;
  const pause = Number(values.pause) * 1000;
  const todo = (await missing(await cargoCrates(), cratePublished)).slice(0, limit);
  const failed: string[] = [];
  for (const crate of todo) {
    const cmd = [
      "cargo",
      "publish",
      "--allow-dirty",
      "--manifest-path",
      crate.manifest,
      ...(apply ? [] : ["--dry-run"]),
    ];
    if ((await run(cmd)) !== 0) failed.push(`${crate.name}@${crate.version}`);
    else if (apply && pause > 0) await Bun.sleep(pause);
  }
  console.log(`crates.io: ${todo.length - failed.length}/${todo.length} ${apply ? "published" : "verified"}`);
  if (failed.length) throw new Error(`crates failed: ${failed.join(", ")}`);
}

if (import.meta.main) {
  const stages: Record<string, () => Promise<void>> = {
    verify,
    plan,
    npm: publishNpm,
    crates: publishCrates,
    all: async () => {
      await verify();
      await publishNpm();
      await publishCrates();
    },
  };
  const action = stages[stage];
  if (!action) {
    console.error(`usage: bun scripts/release.ts ${Object.keys(stages).join("|")} [--apply] [--only a,b] [--limit N]`);
    process.exit(2);
  }
  await action();
}
