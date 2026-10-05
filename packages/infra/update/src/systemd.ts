// SPDX-License-Identifier: Apache-2.0
/**
 * Dev-env module: user systemd units (rendered from the yolo unit catalog -> ~/.config/systemd/user) and /etc/wsl.conf.
 *   check    drift between repo units and installed units, live-only units, wsl.conf keys
 *   install  write every catalog unit, or only the named ones (differing copies are kept as *.pre-update), daemon-reload   [unit...] [--apply]
 *   restart  try-restart units that run a given binary (default: units mentioning bun or aphrody)  [--apply]
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Ctx } from "./context.ts";

export type UnitState = "missing" | "current" | "stale-copy" | "foreign-link";

interface Rendered {
  file: string;
  text: string;
}
const unitDir = () =>
  process.env.APHRODY_SYSTEMD_USER_DIR ?? join(homedir(), ".config", "systemd", "user");
const isUnit = (f: string) => /\.(service|timer|socket|path|target)$/.test(f);

/** The unit catalog and renderer live in yolo (`@aphrody/yolo-core/units`); APHRODY_YOLO_ROOT or ~/aphrody. */
export function renderedUnits(): Rendered[] {
  const root = process.env.APHRODY_YOLO_ROOT ?? join(homedir(), "aphrody");
  const entry = join(root, "packages/engine/core/src/units/index.ts");
  if (!existsSync(entry))
    throw new Error(`yolo unit catalog missing: ${entry} (set APHRODY_YOLO_ROOT)`);
  return (createRequire(import.meta.url)(entry) as { renderAll(): Rendered[] }).renderAll();
}

export function repoUnits(_c?: Ctx): string[] {
  return renderedUnits()
    .map((u) => u.file)
    .filter((f) => !f.includes("/"))
    .toSorted();
}

export function stateOf(
  _c: Ctx | undefined,
  name: string,
  dir = unitDir(),
  rendered = renderedUnits(),
): UnitState {
  const want = rendered.find((u) => u.file === name);
  const dst = join(dir, name);
  if (!existsSync(dst) && !isLink(dst)) return "missing";
  if (isLink(dst)) return "foreign-link";
  return want && readFileSync(dst, "utf8") === want.text ? "current" : "stale-copy";
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Keys required by the repo template that /etc/wsl.conf does not set the same way. */
export function wslDrift(template: string, live: string): string[] {
  const parse = (t: string) => {
    const out = new Map<string, string>();
    let section = "";
    for (const raw of t.split("\n")) {
      const l = raw.trim();
      if (!l || l.startsWith("#")) continue;
      const s = /^\[(.+)\]$/.exec(l);
      if (s) {
        section = s[1]!;
        continue;
      }
      const kv = /^([^=]+)=(.*)$/.exec(l);
      if (kv) out.set(`${section}.${kv[1]!.trim()}`, kv[2]!.trim());
    }
    return out;
  };
  const want = parse(template);
  const have = parse(live);
  return [...want]
    .filter(([k, v]) => have.get(k) !== v)
    .map(([k, v]) => `${k}: want ${v}, have ${have.get(k) ?? "(unset)"}`);
}

export function check(c: Ctx): number {
  let bad = 0;
  for (const u of repoUnits(c)) {
    const st = stateOf(c, u);
    if (st !== "current") {
      bad++;
    }
    console.log(`unit   ${u.padEnd(46)} ${st}`);
  }
  const live = existsSync(unitDir()) ? readdirSync(unitDir()).filter(isUnit) : [];
  const own = new Set(repoUnits(c));
  const orphan = live.filter((u) => !own.has(u) && /^(aphrody|shenron|rg)-/.test(u));
  for (const u of orphan)
    console.log(`unit   ${u.padEnd(46)} live-only (not in the yolo unit catalog)`);
  const tpl = "config/wsl/wsl.conf";
  if (c.exists(tpl) && existsSync("/etc/wsl.conf")) {
    const drift = wslDrift(c.read(tpl), readFileSync("/etc/wsl.conf", "utf8"));
    for (const d of drift) {
      console.log(`wsl    ${d}`);
      bad++;
    }
    if (!drift.length) console.log("wsl    /etc/wsl.conf matches config/wsl/wsl.conf");
  }
  return bad ? 1 : 0;
}

export function install(c: Ctx, only: string[] = []): number {
  const rendered = renderedUnits();
  const units = repoUnits();
  const unknown = only.filter((u) => !units.includes(u));
  if (unknown.length) {
    console.error(`unknown catalog unit: ${unknown.join(", ")}`);
    return 2;
  }
  const dir = unitDir();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const wanted = only.length ? only : units;
  for (const u of rendered.filter(
    (r) => wanted.includes(r.file) || wanted.some((w) => r.file.startsWith(`${w}.d/`)),
  )) {
    const st = stateOf(c, u.file, dir, rendered);
    if (st === "current") continue;
    console.log(`${c.apply ? "write " : "would "} ${u.file} (${st})`);
    if (!c.apply) continue;
    const dst = join(dir, u.file);
    if (st !== "missing") {
      if (isLink(dst)) unlinkSync(dst);
      else renameSync(dst, `${dst}.pre-update-${stamp}`); // never overwrite a copy without keeping it
    }
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, u.text);
  }
  if (c.apply) c.run("systemctl", ["--user", "daemon-reload"], { inherit: true });
  return 0;
}

export function restart(c: Ctx, needles: string[]): number {
  const active = c
    .run("systemctl", [
      "--user",
      "list-units",
      "--type=service",
      "--state=active",
      "--no-legend",
      "--plain",
    ])
    .stdout.split("\n")
    .map((l) => l.split(/\s+/)[0]!)
    .filter((u) => /^(aphrody|shenron|rg)-/.test(u));
  for (const u of active) {
    const text = c.run("systemctl", ["--user", "cat", u]).stdout;
    if (!needles.some((n) => text.includes(n))) continue;
    console.log(`${c.apply ? "restart" : "would restart"} ${u}`);
    if (c.apply) c.run("systemctl", ["--user", "try-restart", u], { inherit: true });
  }
  return 0;
}

export function runSystemd(c: Ctx, args: string[]): number {
  switch (args[0] ?? "check") {
    case "check":
      return check(c);
    case "install":
      return install(
        c,
        args.slice(1).filter((a) => !a.startsWith("-")),
      );
    case "restart":
      return restart(
        c,
        args.slice(1).filter((a) => !a.startsWith("-")).length
          ? args.slice(1).filter((a) => !a.startsWith("-"))
          : [".bun/bin/bun", "aphrody-kernel", "aphrody"],
      );
    default:
      console.error("usage: systemd [check|install [unit...]|restart [needle...]]");
      return 2;
  }
}
