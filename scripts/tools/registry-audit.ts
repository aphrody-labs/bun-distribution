#!/usr/bin/env bun
// Audit npm + crates.io packages of the owner against workspace manifests.
// Default: report orphans. --apply: npm deprecate orphans (reversible, never unpublish).
import { Glob } from "bun";
import { homedir } from "node:os";

const apply = process.argv.includes("--apply");
const MAINTAINERS = (process.env.REGISTRY_MAINTAINERS ?? "yohan971").split(",");
const ROOTS = (
  process.env.REGISTRY_ROOTS ??
  `${homedir()}/aphrody,${homedir()}/yolo,/mnt/c/iecode,${homedir()}/plugins`
).split(",");
const MIN_AGE_DAYS = Number(process.env.REGISTRY_MIN_AGE_DAYS ?? 21);
const KEEP = new Set(
  (process.env.REGISTRY_KEEP ?? "@aphrody/yolo,@aphrody/bxc,@aphrody/bxc-test").split(","),
);
const MESSAGE = "Abandoned: superseded by the aphrody-labs monorepos. No further releases.";

const local = new Set<string>();
let corpus = "";
for (const root of ROOTS) {
  const glob = new Glob("**/{package.json,Cargo.toml}");
  for await (const file of glob.scan({ cwd: root, absolute: true, dot: false })) {
    if (file.includes("/node_modules/") || file.includes("/target/") || file.includes("/vendor/"))
      continue;
    const text = await Bun.file(file)
      .text()
      .catch(() => "");
    const name = file.endsWith("package.json")
      ? (() => {
          try {
            return JSON.parse(text).name;
          } catch {
            return undefined;
          }
        })()
      : /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1];
    if (name) local.add(name);
    corpus += text;
  }
}

const published = new Map<string, { version: string; date: string }>();
for (const m of MAINTAINERS) {
  const proc = Bun.spawn(["npm", "search", "--json", "--searchlimit=250", `maintainer:${m}`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const rows = JSON.parse((await new Response(proc.stdout).text()) || "[]") as {
    name: string;
    version: string;
    date: string;
  }[];
  for (const r of rows) published.set(r.name, { version: r.version, date: r.date.slice(0, 10) });
}

// An orphan still consumed as a dependency anywhere is kept (no deprecation warning for live users).
const orphans = [...published].filter(([n]) => !local.has(n) && !corpus.includes(`"${n}"`));
const stale = (d: string) => (Date.now() - Date.parse(d)) / 864e5 >= MIN_AGE_DAYS;
console.log(
  `npm published=${published.size} local manifests=${local.size} orphans=${orphans.length}`,
);
for (const [name, { version, date }] of orphans) {
  const eligible = stale(date) && !KEEP.has(name);
  console.log(
    `${apply && eligible ? "deprecate" : eligible ? "orphan" : "keep(recent/keep-list)"} ${name}@${version} ${date}`,
  );
  if (apply && eligible) {
    const p = Bun.spawn(["npm", "deprecate", name, MESSAGE], {
      stdout: "ignore",
      stderr: "inherit",
    });
    await p.exited;
  }
}
