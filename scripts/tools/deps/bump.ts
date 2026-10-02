#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Keeps bun, uv, the Tauri crate family and the Bun workspace on the latest published versions.
//
//   bun scripts/tools/deps/bump.ts             report only (default)
//   bun scripts/tools/deps/bump.ts --apply     rewrite pins, run `uv self update`, `bun update -r`
//   bun scripts/tools/deps/bump.ts --apply --verify   then run the serialized gates
//
// Cargo: only the `tauri*`/`wry`/`tao` family is rewritten (prereleases included, same major line).
// Everything else in [workspace.dependencies] is reported, never bulk-updated (repo rule).
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify");
const root = new URL("../../../", import.meta.url).pathname;
const UA = { "user-agent": "aphrody-deps-bump (contact@aphrody.com)" };

const run = (cmd: string, args: string[], inherit = false) =>
  spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: inherit ? "inherit" : "pipe" });
const json = async (url: string) => (await fetch(url, { headers: UA })).json() as Promise<any>;
const read = (p: string) => readFileSync(root + p, "utf8");
const write = (p: string, s: string) => apply && writeFileSync(root + p, s);

const changes: string[] = [];
const note = (m: string) => { changes.push(m); console.log(m); };

function replaceAll(file: string, from: string, to: string) {
  const s = read(file);
  if (!s.includes(from)) return;
  write(file, s.split(from).join(to));
}

// ---- uv and bun ----------------------------------------------------------------------------
async function tool(name: "uv" | "bun") {
  const repo = name === "uv" ? "astral-sh/uv" : "oven-sh/bun";
  const rel = await json(`https://api.github.com/repos/${repo}/releases/latest`);
  const latest = String(rel.tag_name).replace(/^bun-v/, "").replace(/^v/, "");
  const cur = run(name, ["--version"]).stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? "?";
  if (cur === latest) return console.log(`ok     ${name} ${cur}`);
  note(`bump   ${name} ${cur} -> ${latest}`);
  if (!apply) return;
  run(name, name === "uv" ? ["self", "update"] : ["upgrade"], true);
  // The release tag can precede the installer channel: pin what is actually installed.
  const installed = run(name, ["--version"]).stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? cur;
  if (installed !== latest) console.warn(`warn   ${name} ${latest} is tagged but the installer serves ${installed}; pinning ${installed}`);
  for (const f of ["config/system-packages.json", "packages/infra/workspace/src/runtime-versions.ts", "docs/reference/workspace/CLI.md"]) {
    replaceAll(f, cur, installed);
  }
  if (name === "bun") {
    for (const k of ['"@types/bun": "' , '"bun-types": "^']) {
      const s = read("package.json");
      write("package.json", s.replace(new RegExp(`(${k.replace(/[$^]/g, "\\$&")})\\d+\\.\\d+\\.\\d+`), `$1${installed}`));
    }
  }
}

// ---- Tauri crate family --------------------------------------------------------------------
const FAMILY = /^(tauri(-[a-z-]+)?|wry|tao)$/;
async function newest(crate: string, currentMajor: string) {
  const d = await json(`https://crates.io/api/v1/crates/${crate}/versions`);
  const vs = (d.versions as any[]).filter((v) => !v.yanked).map((v) => v.num as string)
    .filter((v) => v.split(".")[0] === currentMajor);
  return vs[0]; // crates.io lists newest first
}
async function cargoFamily() {
  let toml = read("Cargo.toml");
  const re = /^((?:tauri(?:-[a-z-]+)?|wry|tao))\s*=\s*(\{[^}]*version\s*=\s*"|")=?([^"]+)"/gm;
  const seen: [string, string, string][] = [];
  for (const m of toml.matchAll(re)) {
    if (!FAMILY.test(m[1]) || /path\s*=|git\s*=/.test(m[0])) continue;
    seen.push([m[1], m[3], m[3].split(".")[0]]);
  }
  for (const [crate, cur, major] of seen) {
    const latest = await newest(crate, major);
    await Bun.sleep(250); // crates.io crawler policy
    if (!latest || latest === cur) continue;
    note(`bump   cargo ${crate} ${cur} -> ${latest}`);
    toml = toml.replace(new RegExp(`^(${crate}\\s*=\\s*(?:\\{[^}]*version\\s*=\\s*"|"))=?${cur.replace(/[.+]/g, "\\$&")}"`, "m"), `$1=${latest}"`);
  }
  write("Cargo.toml", toml);
}

// ---- Bun workspace -------------------------------------------------------------------------
function bunWorkspace() {
  const out = run("bun", ["outdated", "-r"]).stdout;
  const rows = out.split("\n").filter((l) => /^\| [^-P]/.test(l));
  console.log(`info   bun outdated: ${rows.length} rows (majors need a migration; \`bun update -r\` applies in-range only)`);
  if (apply) run("bun", ["update", "-r"], true);
}

await tool("uv");
await tool("bun");
await cargoFamily();
bunWorkspace();

if (apply && verify) {
  const gates: [string, string[]][] = [
    ["bash", ["scripts/build/rust/cargo-serial.sh", "check", "-p", "aphrody-shell-tauri", "-p", "aphrody-app"]],
    ["bun", ["run", "bun:check"]],
    ["bun", ["run", "monorepo:layout"]],
  ];
  for (const [c, a] of gates) {
    console.log(`gate   ${c} ${a.join(" ")}`);
    if (run(c, a, true).status !== 0) { console.error("gate failed"); process.exit(1); }
  }
}
console.log(changes.length ? `${apply ? "applied" : "pending"}: ${changes.length} change(s)` : "everything is current");
