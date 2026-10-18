// SPDX-License-Identifier: Apache-2.0
// Explore every crate and package of the workspace from its manifests: purpose, kind, internal dependency graph,
// consumers, and whether a crate can plausibly build for wasm32 (no native-only dependency anywhere below it).
//   bun scripts/workspace-explore.ts [--json FILE] [--group PREFIX]
import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";

const root = resolve(import.meta.dir, "..");

/** External crates that cannot target wasm32-unknown-unknown (OS services, native TLS, C builds, threads runtimes). */
const NATIVE_ONLY = new Set([
  "tokio-uring", "mio", "libc", "nix", "windows", "windows-sys", "winapi", "zbus", "dbus", "aws-lc-sys", "aws-lc-rs", "openssl", "openssl-sys",
  "ring-native", "cpal", "alsa", "libpulse-binding", "rusb", "hidapi", "portable-pty", "notify", "rusqlite-bundled", "libloading",
  "core-foundation", "objc2", "cocoa", "gtk", "gtk4", "wayland-client", "x11rb", "xcb", "smithay", "ash", "vulkano", "cuda", "cudarc",
  "wgpu-hal-native", "rdkafka", "libgit2-sys", "git2", "tauri", "tao", "wry", "pyo3", "napi", "mlua", "v8", "rquickjs", "reqwest-native",
  "ffmpeg-next", "ffmpeg-sys-next", "bindgen", "cc-native", "rustix-native", "async-process", "async-io-native", "tun", "pcap",
]);

interface Crate {
  name: string;
  dir: string;
  description: string;
  kinds: string[];
  bins: string[];
  internal: string[];
  external: string[];
  wasmTable: boolean;
  wasmBindgen: boolean;
  nativeDirect: string[];
  manifest: string;
  workspaceMember: boolean;
  buildTarget: string[];
  qualification: "not-executed";
}
interface Pkg {
  name: string;
  dir: string;
  description: string;
  bins: string[];
  internal: string[];
  external: string[];
  browser: boolean;
  wasmDir: boolean;
  scripts: Record<string, string>;
  exports: unknown;
  workspaceMember: boolean;
  qualification: "not-executed";
}

const rootCargo = Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as {
  workspace?: { members?: string[] };
};
const rootBun = await Bun.file(join(root, "package.json")).json();
const sourceConfig = await Bun.file(join(root, "aphrody.config.json")).json();
const appInventory = await Bun.file(join(root, "infra/apps.json")).json();
const cargoMembers = (rootCargo.workspace?.members ?? []).map(pattern => new Bun.Glob(pattern));
const bunMembers = (rootBun.workspaces ?? []).map((pattern: string) => new Bun.Glob(pattern));
async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function tomlSections(text: string): Map<string, string> {
  const map = new Map<string, string>();
  let name = "";
  let body: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\[(.+)\]\s*$/.exec(line);
    if (m) {
      if (name) map.set(name, body.join("\n"));
      name = m[1]!;
      body = [];
    } else body.push(line);
  }
  if (name) map.set(name, body.join("\n"));
  return map;
}

function depNames(body: string): string[] {
  return [...body.matchAll(/^([A-Za-z0-9_-]+)\s*(?:=|\.)/gm)].map(m => m[1]!);
}

const crates = new Map<string, Crate>();
for await (const file of new Bun.Glob("{crates,apps}/*/Cargo.toml").scan({ cwd: root })) {
  const text = await Bun.file(join(root, file)).text();
  const sections = tomlSections(text);
  const pkg = sections.get("package") ?? "";
  const name = /^name\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
  if (!name) continue;
  const description = /^description\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(pkg)?.[1] ?? "";
  const dirName = dirname(file);
  const lib = sections.get("lib") ?? "";
  const kinds = [...(/crate-type\s*=\s*\[([^\]]*)\]/.exec(lib)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map(m => m[1]!);
  const bins = text.split("[[bin]]").slice(1).map(b => /name\s*=\s*"([^"]+)"/.exec(b)?.[1] ?? "").filter(Boolean);
  // Cargo's implicit binary target is real even without a [[bin]] table.
  if (!/^autobins\s*=\s*false/m.test(pkg) && await Bun.file(join(root, dirName, "src/main.rs")).exists() && !bins.includes(name)) bins.push(name);
  const internal = new Set<string>();
  const external = new Set<string>();
  let wasmTable = false;
  const nativeDirect = new Set<string>();
  for (const [section, body] of sections) {
    const isDep = /(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(section);
    if (!isDep || section.endsWith("dev-dependencies")) continue;
    const gated = section.startsWith("target.");
    if (/wasm32/.test(section)) wasmTable = true;
    const nativeGate = gated && /not\(target_arch = "wasm32"\)|unix|windows|linux|macos|android/.test(section) && !/wasm32"\)\)?$/.test(section.replace(/not\(.*\)/, ""));
    for (const dep of depNames(body)) {
      const line = new RegExp(`^${dep}\\s*[=.].*$`, "m").exec(body)?.[0] ?? "";
      if (/path\s*=/.test(line) || /workspace\s*=\s*true/.test(line)) internal.add(dep);
      else external.add(dep);
      if (NATIVE_ONLY.has(dep) && !nativeGate && !/wasm32"\)\)?$/.test(section) === false) nativeDirect.add(dep);
      else if (NATIVE_ONLY.has(dep) && !gated) nativeDirect.add(dep);
    }
  }
  crates.set(name, {
    name, dir: dirName, description, kinds, bins, internal: [...internal], external: [...external], wasmTable,
    wasmBindgen: external.has("wasm-bindgen"), nativeDirect: [...nativeDirect],
    manifest: file.replaceAll("\\", "/"),
    workspaceMember: cargoMembers.some(pattern => pattern.match(dirName.replaceAll("\\", "/"))),
    buildTarget: bins.map(binary => `cargo build --locked -p ${name} --bin ${binary}`),
    qualification: "not-executed",
  });
}
// A workspace = true dependency may be external; keep only names that are crates of this repository as internal.
for (const c of crates.values()) {
  const ext = c.internal.filter(n => !crates.has(n));
  c.internal = c.internal.filter(n => crates.has(n));
  c.external.push(...ext);
}

const consumers = new Map<string, Set<string>>();
for (const c of crates.values()) for (const dep of c.internal) (consumers.get(dep) ?? consumers.set(dep, new Set()).get(dep)!).add(c.name);

const nativeMemo = new Map<string, string[]>();
function nativeBelow(name: string, seen = new Set<string>()): string[] {
  const cached = nativeMemo.get(name);
  if (cached) return cached;
  if (seen.has(name)) return [];
  seen.add(name);
  const c = crates.get(name);
  if (!c) return [];
  const out = new Set(c.nativeDirect);
  for (const dep of c.internal) for (const n of nativeBelow(dep, seen)) out.add(n);
  const list = [...out];
  nativeMemo.set(name, list);
  return list;
}

const packages = new Map<string, Pkg>();
for await (const file of new Bun.Glob("{packages,apps}/*/package.json").scan({ cwd: root })) {
  try {
    const j = JSON.parse(await Bun.file(join(root, file)).text()) as {
      name?: string; description?: string; bin?: string | Record<string, string>;
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>; browser?: unknown; exports?: unknown;
      scripts?: Record<string, string>;
    };
    const dir = dirname(file);
    const name = j.name ?? dir;
    const deps = Object.keys({ ...j.dependencies });
    packages.set(name, {
      name, dir, description: j.description ?? "",
      bins: typeof j.bin === "string" ? [name] : Object.keys(j.bin ?? {}),
      internal: deps.filter(d => d.startsWith("@aphrody/")), external: deps.filter(d => !d.startsWith("@aphrody/")),
      browser: !!j.browser || JSON.stringify(j.exports ?? {}).includes('"browser"'),
      wasmDir: await directoryExists(join(root, dir, "wasm")),
      scripts: j.scripts ?? {}, exports: j.exports ?? null,
      workspaceMember: bunMembers.some((pattern: Bun.Glob) => pattern.match(dir.replaceAll("\\", "/"))),
      qualification: "not-executed",
    });
  } catch {
    // Manifest without valid JSON: skipped.
  }
}

const args = Bun.argv.slice(2);
const prefix = args[args.indexOf("--group") + 1] && args.includes("--group") ? args[args.indexOf("--group") + 1]! : "";
const report = {
  schemaVersion: 2,
  evidence: "source-manifests-only",
  qualification: "not-executed",
  sources: sourceConfig.modules.map((module: { id: string; fork: string; upstream: string; revision: string; sourceKind?: string; manifestPath?: string }) => ({
    component: module.id,
    repository: module.fork,
    upstream: module.upstream,
    recordedSourceRevision: module.revision,
    sourceKind: module.sourceKind ?? "submodule",
    manifest: module.manifestPath ?? null,
    qualification: "not-executed",
  })),
  applications: appInventory.apps.map((app: { id: string; kind: string; native: unknown; entrypoint: string }) => ({
    component: app.id, kind: app.kind, native: app.native, entrypoint: app.entrypoint,
    declaredTargets: appInventory.targets, qualification: "not-executed",
  })),
  generated: new Date().toISOString(),
  crates: [...crates.values()].map(c => ({
    ...c,
    consumers: [...(consumers.get(c.name) ?? [])].sort(),
    nativeBelow: nativeBelow(c.name),
    wasmCandidate: nativeBelow(c.name).length === 0 && !c.kinds.includes("proc-macro"),
  })).sort((a, b) => a.name.localeCompare(b.name)),
  packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
};
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
if (out) await Bun.write(resolve(out), JSON.stringify(report, null, 2));

const rows = report.crates.filter(c => c.name.startsWith(prefix));
const clean = rows.filter(c => c.wasmCandidate);
const families = new Map<string, number>();
for (const c of rows) families.set(c.name.split("-")[0]!, (families.get(c.name.split("-")[0]!) ?? 0) + 1);
console.log(`crates/apps: ${rows.length}, wasm candidates (manifest heuristic, unqualified): ${clean.length}, packages: ${report.packages.length}`);
console.log(`largest families: ${[...families].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k}:${n}`).join(" ")}`);
console.log(`unused crates (no consumer, no binary): ${rows.filter(c => !c.consumers.length && !c.bins.length && !c.kinds.includes("cdylib")).length}`);
