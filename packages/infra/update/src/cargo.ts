// SPDX-License-Identifier: Apache-2.0
/**
 * Cargo module: refresh Cargo.lock inside the manifest ranges through the serialized wrapper.
 * Report-only by default (`cargo update --dry-run`); `--apply` rewrites the lock and records a journal run.
 * The lock is snapshotted first; use `cargo.ts restore` semantics by copying target/update/Cargo.lock.before back.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Ctx } from "./context.ts";
import type { Change } from "./deps/sync.ts";

export function lockMap(text: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const b of text.split("[[package]]").slice(1)) {
    const n = /^name = "([^"]+)"/m.exec(b)?.[1];
    const v = /^version = "([^"]+)"/m.exec(b)?.[1];
    if (n && v) (m.get(n) ?? m.set(n, new Set()).get(n)!).add(v);
  }
  return m;
}

export function lockDiff(
  before: Map<string, Set<string>>,
  after: Map<string, Set<string>>,
): Change[] {
  const out: Change[] = [];
  for (const [n, vs] of after) {
    const old = before.get(n);
    if (!old) {
      out.push({ ecosystem: "cargo-lock", name: n, from: "(new)", to: [...vs].join(",") });
      continue;
    }
    const a = [...old].toSorted().join(",");
    const b = [...vs].toSorted().join(",");
    if (a !== b) out.push({ ecosystem: "cargo-lock", name: n, from: a, to: b });
  }
  for (const n of before.keys())
    if (!after.has(n))
      out.push({
        ecosystem: "cargo-lock",
        name: n,
        from: [...before.get(n)!].join(","),
        to: "(removed)",
      });
  return out;
}

export function runCargo(c: Ctx, _args: string[]): number {
  const wrapper = "scripts/build/rust/cargo-serial.sh";
  if (!c.apply) {
    const r = c.run("bash", [wrapper, "update", "--dry-run"]);
    const lines = (r.stderr + r.stdout)
      .split("\n")
      .filter((l) =>
        /^\s+(Updating|Adding|Removing|Downgrading|Locking)|unchanged dependencies/.test(l),
      );
    console.log(
      `cargo  dry run: ${lines.filter((l) => /Updating|Locking/.test(l)).length} update(s), ${lines.filter((l) => /Downgrading/.test(l)).length} downgrade(s)`,
    );
    for (const line of lines.filter((l) => /unchanged dependencies/.test(l)))
      console.log(`cargo  ${line.trim()}`);
    return 0;
  }
  const dir = join(c.root, "target", "update");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(c.root, "Cargo.lock"), join(dir, "Cargo.lock.before"));
  const before = lockMap(c.read("Cargo.lock"));
  if (c.run("bash", [wrapper, "update"], { inherit: true }).status !== 0) return 1;
  const changes = lockDiff(before, lockMap(c.read("Cargo.lock")));
  console.log(
    `cargo  lock refreshed: ${changes.length} package change(s); snapshot target/update/Cargo.lock.before`,
  );
  const j = c.journal();
  j.runs.push({ date: new Date().toISOString().slice(0, 10), changes: changes.slice(0, 400) });
  c.saveJournal(j);
  return 0;
}
