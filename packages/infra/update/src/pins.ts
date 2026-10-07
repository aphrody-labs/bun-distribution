// SPDX-License-Identifier: Apache-2.0
/**
 * Tool pin manifest (tools/config/update/pins.json): every hardcoded tool version, one capture group per target.
 * `check` fails when targets of a tool disagree; `apply` rewrites them all.
 */
import { Ctx } from "./context.ts";

export type Target = { file?: string; glob?: string; re: string; multiline?: boolean };
export type PinTool = { latest: { github?: string; pypi?: string; npm?: string; crate?: string; stripTag?: string }; targets: Target[] };
export type PinFile = { tools: Record<string, PinTool> };
export type Hit = { file: string; version: string };

const SKIP = /(^|\/)(node_modules|target|upstream|dist|\.next)\//;

export function targetFiles(c: Ctx, t: Target): string[] {
  if (t.file) return c.exists(t.file) ? [t.file] : [];
  const out: string[] = [];
  for (const f of new Bun.Glob(t.glob!).scanSync({ cwd: c.root })) if (!SKIP.test(f)) out.push(f);
  return out.toSorted();
}

function regex(t: Target): RegExp {
  return new RegExp(t.re, t.multiline ? "gm" : "g");
}

/** Versions captured by one target in one text. */
export function capture(text: string, t: Target): string[] {
  return [...text.matchAll(regex(t))].map((m) => m[1]!).filter(Boolean);
}

/** Replace the capture group of every match with `version`. */
export function rewrite(text: string, t: Target, version: string): string {
  return text.replace(regex(t), (full, g1: string) => {
    const i = full.lastIndexOf(g1);
    return full.slice(0, i) + version + full.slice(i + g1.length);
  });
}

export function load(c: Ctx): PinFile {
  return c.jsonFile<PinFile>("tools/config/update/pins.json", { tools: {} });
}

export function collect(c: Ctx, tool: PinTool): Hit[] {
  const hits: Hit[] = [];
  for (const t of tool.targets) {
    for (const f of targetFiles(c, t)) for (const version of capture(c.read(f), t)) hits.push({ file: f, version });
  }
  return hits;
}

/** Source of truth = first hit. Returns a drift list per tool. */
export function check(c: Ctx): { tool: string; pin?: string; drift: Hit[]; missing: string[] }[] {
  const out: { tool: string; pin?: string; drift: Hit[]; missing: string[] }[] = [];
  for (const [name, tool] of Object.entries(load(c).tools)) {
    const hits = collect(c, tool);
    const pin = hits[0]?.version;
    const missing = tool.targets.filter((t) => t.file && !c.exists(t.file) || (t.file && c.exists(t.file) && capture(c.read(t.file), t).length === 0)).map((t) => `${t.file}: /${t.re}/`);
    out.push({ tool: name, pin, drift: hits.filter((h) => h.version !== pin), missing });
  }
  return out;
}

export function apply(c: Ctx, name: string, version: string): string[] {
  const tool = load(c).tools[name];
  if (!tool) throw new Error(`unknown tool ${name}`);
  const touched: string[] = [];
  for (const t of tool.targets) {
    for (const f of targetFiles(c, t)) {
      const before = c.read(f);
      const after = rewrite(before, t, version);
      if (after !== before) { c.write(f, after); touched.push(f); }
    }
  }
  return [...new Set(touched)];
}

export function runPins(c: Ctx, args: string[]): number {
  const sub = args[0] ?? "check";
  if (sub === "apply") {
    const [, name, version] = args;
    if (!name || !version) { console.error("usage: pins apply <tool> <version>"); return 2; }
    for (const f of apply(c, name, version)) console.log(`pin    ${name} ${version} -> ${f}`);
    return 0;
  }
  let bad = 0;
  for (const r of check(c)) {
    const state = r.drift.length ? `DRIFT ${r.drift.length}` : "ok";
    console.log(`pin    ${r.tool.padEnd(10)} ${r.pin ?? "?"}  ${state}`);
    for (const d of r.drift) { console.log(`         ${d.file}: ${d.version}`); bad++; }
    for (const m of r.missing) console.log(`         no match: ${m}`);
  }
  return bad ? 1 : 0;
}
