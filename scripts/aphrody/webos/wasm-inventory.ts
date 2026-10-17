#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Static WebAssembly readiness inventory of a Cargo workspace and its Bun/TS packages.
 *
 *   bun scripts/webos/wasm-inventory.ts [--root <repo>] [--json <file>] [--md <file>]
 *
 * Reads every workspace member's Cargo.toml (inherited `workspace = true` dependencies included),
 * skips dependencies gated on a cfg that cannot hold on wasm (`windows`, `unix`, `target_os = ...`),
 * classifies the remaining external crates with BLOCKERS, propagates the verdict through internal
 * path dependencies, and scans packages/** sources for host-only imports. It is a static first pass:
 * the final pass confirms it with `cargo check --target wasm32-*` (PLAN-ALPINE-BUN.md, section X).
 */
import { dirname, join, relative, resolve } from "node:path";

export type Verdict = "ok" | "adapt" | "blocked";

/** External crate -> verdict on wasm32 and the way out. `adapt` = feature, cfg or a pure-Rust swap. */
export const BLOCKERS: Record<string, { verdict: Verdict; why: string }> = {
  // TLS / crypto in C
  openssl: { verdict: "blocked", why: "OpenSSL (C): use rustls + ring/rustcrypto" },
  "openssl-sys": { verdict: "blocked", why: "OpenSSL (C): use rustls + ring/rustcrypto" },
  "native-tls": { verdict: "blocked", why: "OS TLS: use rustls, or the browser fetch on wasm32-unknown-unknown" },
  "hyper-tls": { verdict: "blocked", why: "native-tls: use hyper-rustls" },
  "tokio-native-tls": { verdict: "blocked", why: "native-tls" },
  "aws-lc-rs": { verdict: "blocked", why: "aws-lc (C/asm): rustls `ring` provider" },
  "aws-lc-sys": { verdict: "blocked", why: "aws-lc (C/asm)" },
  ring: { verdict: "adapt", why: "C/asm: builds for wasm32 with clang; prefer rustcrypto" },
  rustls: { verdict: "adapt", why: "default aws-lc provider: select `ring`, no sockets in the browser" },
  // JS engines, Python, native runtimes
  v8: { verdict: "blocked", why: "rusty_v8 (C++ V8): the page's JS engine replaces it" },
  deno_core: { verdict: "blocked", why: "V8" },
  pyo3: { verdict: "blocked", why: "CPython: Pyodide is the only browser route" },
  wasmtime: { verdict: "blocked", why: "JIT runtime: the browser already runs wasm" },
  "wasmtime-wasi": { verdict: "blocked", why: "wasmtime" },
  wasmer: { verdict: "blocked", why: "JIT runtime" },
  // ML native backends
  ort: { verdict: "blocked", why: "ONNX Runtime (C++): onnxruntime-web or candle on wasm" },
  "ort-sys": { verdict: "blocked", why: "ONNX Runtime (C++)" },
  fastembed: { verdict: "blocked", why: "ort: candle/tract embeddings" },
  "mistralrs": { verdict: "blocked", why: "mistral.rs (CUDA/Metal, tokio net): out of the browser" },
  "mistralrs-core": { verdict: "blocked", why: "mistral.rs" },
  "llama-cpp-2": { verdict: "blocked", why: "llama.cpp (C++): wllama/web-llm instead" },
  "llama-cpp-sys-2": { verdict: "blocked", why: "llama.cpp (C++)" },
  tch: { verdict: "blocked", why: "libtorch" },
  cudarc: { verdict: "blocked", why: "CUDA" },
  "candle-core": { verdict: "adapt", why: "pure Rust; disable cuda/metal/mkl" },
  tokenizers: { verdict: "adapt", why: "onig (C): features `unstable_wasm` + fancy-regex" },
  "hf-hub": { verdict: "adapt", why: "network + fs cache: fetch + OPFS" },
  // GUI / desktop
  tauri: { verdict: "blocked", why: "desktop shell: the WebOS is the shell" },
  "tauri-build": { verdict: "blocked", why: "desktop shell" },
  wry: { verdict: "blocked", why: "webview host" },
  tao: { verdict: "blocked", why: "native windowing" },
  winit: { verdict: "adapt", why: "web backend exists (canvas)" },
  "tray-icon": { verdict: "blocked", why: "OS tray" },
  muda: { verdict: "blocked", why: "OS menus" },
  arboard: { verdict: "blocked", why: "OS clipboard: navigator.clipboard" },
  enigo: { verdict: "blocked", why: "OS input injection" },
  xcap: { verdict: "blocked", why: "OS screen capture" },
  screenshots: { verdict: "blocked", why: "OS screen capture" },
  // OS, processes, terminals
  nix: { verdict: "blocked", why: "POSIX syscalls: WASI or the WebOS process table" },
  procfs: { verdict: "blocked", why: "/proc" },
  "portable-pty": { verdict: "blocked", why: "PTY: no terminal layer in the WebOS" },
  "pty-process": { verdict: "blocked", why: "PTY" },
  crossterm: { verdict: "blocked", why: "terminal I/O: typed UI instead" },
  termion: { verdict: "blocked", why: "terminal I/O" },
  sysinfo: { verdict: "adapt", why: "compiles to the empty `unknown` backend: feed it from the WebOS process table" },
  notify: { verdict: "blocked", why: "inotify/ReadDirectoryChanges: VFS change events" },
  keyring: { verdict: "blocked", why: "OS keychain: WebCrypto + IndexedDB" },
  "self-replace": { verdict: "blocked", why: "binary self-update" },
  libloading: { verdict: "blocked", why: "dlopen" },
  "windows-service": { verdict: "blocked", why: "Windows services" },
  memmap2: { verdict: "blocked", why: "mmap: read into memory (OPFS sync handle)" },
  fs2: { verdict: "adapt", why: "file locks: no-op on WASI" },
  "fd-lock": { verdict: "adapt", why: "file locks" },
  libc: { verdict: "adapt", why: "exists for wasi, not for wasm32-unknown-unknown" },
  rustix: { verdict: "adapt", why: "wasi backend only" },
  dirs: { verdict: "adapt", why: "no home dir: inject paths" },
  "dirs-next": { verdict: "adapt", why: "no home dir: inject paths" },
  directories: { verdict: "adapt", why: "no home dir: inject paths" },
  home: { verdict: "adapt", why: "no home dir: inject paths" },
  which: { verdict: "adapt", why: "no PATH: the WebOS module registry" },
  // async / network
  tokio: {
    verdict: "adapt",
    why: "keep rt/sync/time/macros/io-util; net/process/fs/signal block (wasm-bindgen-futures in the browser)",
  },
  mio: { verdict: "blocked", why: "epoll/kqueue/IOCP; WASI p1 only polls fds" },
  socket2: { verdict: "blocked", why: "raw sockets" },
  "tokio-tungstenite": { verdict: "adapt", why: "browser WebSocket (gloo-net / web-sys)" },
  tungstenite: { verdict: "adapt", why: "browser WebSocket" },
  hyper: { verdict: "adapt", why: "client: browser fetch; server: impossible in a page (Service Worker routes)" },
  "hyper-util": { verdict: "adapt", why: "tokio net" },
  axum: { verdict: "adapt", why: "server: expose handlers through a Service Worker instead of a socket" },
  "tower-http": { verdict: "adapt", why: "server stack" },
  tonic: { verdict: "adapt", why: "gRPC: tonic-web over fetch" },
  reqwest: { verdict: "adapt", why: "wasm32-unknown-unknown uses fetch; no blocking, no cookies store, no proxy" },
  ureq: { verdict: "blocked", why: "blocking sockets: reqwest wasm / fetch" },
  curl: { verdict: "blocked", why: "libcurl (C)" },
  isahc: { verdict: "blocked", why: "libcurl (C)" },
  "hickory-resolver": { verdict: "blocked", why: "raw DNS: DoH over fetch" },
  "trust-dns-resolver": { verdict: "blocked", why: "raw DNS" },
  quinn: { verdict: "blocked", why: "UDP" },
  russh: { verdict: "adapt", why: "pure Rust: needs a WebSocket TCP relay" },
  ssh2: { verdict: "blocked", why: "libssh2 (C)" },
  lettre: { verdict: "blocked", why: "SMTP sockets" },
  "async-std": { verdict: "adapt", why: "net/process" },
  // browsers / automation
  chromiumoxide: { verdict: "blocked", why: "drives a Chrome process" },
  headless_chrome: { verdict: "blocked", why: "drives a Chrome process" },
  fantoccini: { verdict: "blocked", why: "WebDriver client over sockets" },
  // storage
  rusqlite: { verdict: "adapt", why: "bundled SQLite (C): wasi-sdk build or sqlite-wasm-rs + OPFS VFS" },
  "libsqlite3-sys": { verdict: "adapt", why: "SQLite (C): wasi-sdk" },
  "sqlite-vec": { verdict: "adapt", why: "C extension: link into the wasm SQLite" },
  sqlx: { verdict: "blocked", why: "network drivers + tokio net" },
  "tokio-postgres": { verdict: "blocked", why: "TCP Postgres" },
  "deadpool-postgres": { verdict: "blocked", why: "TCP Postgres" },
  "tokio-postgres-rustls": { verdict: "blocked", why: "TCP Postgres" },
  postgres: { verdict: "blocked", why: "TCP Postgres" },
  pgvector: { verdict: "blocked", why: "Postgres" },
  redis: { verdict: "blocked", why: "TCP Redis" },
  "qdrant-client": { verdict: "blocked", why: "gRPC over TCP" },
  lancedb: { verdict: "blocked", why: "object store + native arrow kernels" },
  tantivy: { verdict: "adapt", why: "RamDirectory, no mmap" },
  heed: { verdict: "blocked", why: "LMDB (C, mmap)" },
  rocksdb: { verdict: "blocked", why: "RocksDB (C++)" },
  sled: { verdict: "adapt", why: "fs + threads" },
  redb: { verdict: "adapt", why: "in-memory backend" },
  // C code
  "tree-sitter": { verdict: "adapt", why: "C runtime: wasi-sdk, or web-tree-sitter" },
  cc: { verdict: "adapt", why: "build-time C: needs clang --target=wasm32 (wasi-sdk)" },
  bindgen: { verdict: "adapt", why: "build-time C headers" },
  cmake: { verdict: "adapt", why: "native build of a C/C++ dependency" },
  "zstd-sys": { verdict: "adapt", why: "C: wasi-sdk, or ruzstd" },
  zstd: { verdict: "adapt", why: "C: wasi-sdk, or ruzstd" },
  "bzip2-sys": { verdict: "adapt", why: "C" },
  "lzma-sys": { verdict: "adapt", why: "C: lzma-rs" },
  "libz-sys": { verdict: "adapt", why: "C: flate2 rust backend" },
  git2: { verdict: "blocked", why: "libgit2 + OpenSSL: gix without transport" },
  "libgit2-sys": { verdict: "blocked", why: "libgit2" },
  gix: { verdict: "adapt", why: "pure Rust: drop blocking network transport, keep object db over the VFS" },
  "ffmpeg-next": { verdict: "blocked", why: "FFmpeg (C): ffmpeg.wasm or WebCodecs" },
  "ffmpeg-sys-next": { verdict: "blocked", why: "FFmpeg (C)" },
  tesseract: { verdict: "blocked", why: "Tesseract (C++)" },
  leptonica: { verdict: "blocked", why: "Leptonica (C)" },
  // threads / misc
  rayon: { verdict: "adapt", why: "wasm-bindgen-rayon / wasm32-wasip1-threads" },
  getrandom: { verdict: "adapt", why: "`wasm_js` backend on wasm32-unknown-unknown" },
  uuid: { verdict: "adapt", why: "`js` feature for v4" },
  chrono: { verdict: "adapt", why: "`wasmbind` for now()" },
  "wasm-bindgen": { verdict: "ok", why: "" },
  cpal: { verdict: "adapt", why: "WebAudio backend" },
  rodio: { verdict: "adapt", why: "WebAudio backend" },
  wgpu: { verdict: "adapt", why: "WebGPU backend" },
  pprof: { verdict: "blocked", why: "signal-based profiler" },
  "tikv-jemallocator": { verdict: "blocked", why: "jemalloc (C)" },
  mimalloc: { verdict: "adapt", why: "C allocator: default allocator on wasm" },
  "ctrlc": { verdict: "blocked", why: "signals" },
  "signal-hook": { verdict: "blocked", why: "signals" },
};

type Dep = { name: string; internal?: string; optional: boolean };
export type Crate = {
  name: string;
  dir: string;
  description: string;
  hasWasmCfg: boolean;
  wasmTarget: boolean;
  cdylib: boolean;
  deps: Dep[];
  direct: { name: string; verdict: Verdict; why: string }[];
  via: string[];
  verdict: Verdict;
};
export type Pkg = { name: string; dir: string; hits: string[]; verdict: Verdict };

/** True when a `[target.'cfg(...)'.dependencies]` table may apply to a wasm32 target. */
export function cfgMayMatchWasm(cfg: string): boolean {
  const c = cfg.replace(/\s+/g, "");
  if (/wasm|target_family="wasm"|target_os="wasi"/.test(c) && !c.startsWith("cfg(not(")) return true;
  if (/^cfg\(not\(target_(arch="wasm32"|family="wasm")\)\)$/.test(c)) return false;
  if (c.startsWith("cfg(not(")) return true; // not(windows), not(unix) ... hold on wasm
  if (
    /^cfg\((windows|unix|target_os="[^"]+"|target_vendor=|target_env=|target_arch="(x86_64|aarch64|x86|arm)")/.test(c)
  )
    return false;
  if (c.startsWith("cfg(any(")) return /wasm|wasi/.test(c);
  if (c.startsWith("cfg(all(")) return !/(windows|unix|target_os=")/.test(c) || /wasm|wasi/.test(c);
  return /wasm/.test(c);
}

function depsOf(table: Record<string, any> | undefined, ws: Record<string, any>): Dep[] {
  const out: Dep[] = [];
  for (const [key, raw] of Object.entries(table ?? {})) {
    const spec = typeof raw === "string" ? { version: raw } : (raw as Record<string, any>);
    const inherited = spec.workspace === true ? ws[key] : undefined;
    const real = typeof inherited === "string" ? { version: inherited } : (inherited ?? spec);
    const name = (spec.package ?? real.package ?? key) as string;
    out.push({ name, internal: real.path as string | undefined, optional: spec.optional === true });
  }
  return out;
}

async function expandMembers(root: string, patterns: string[], exclude: string[]): Promise<string[]> {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      dirs.add(pattern);
      continue;
    }
    for await (const f of new Bun.Glob(`${pattern}/Cargo.toml`).scan({ cwd: root, onlyFiles: true }))
      dirs.add(dirname(f).replaceAll("\\", "/"));
  }
  return [...dirs].filter(d => !exclude.includes(d)).sort();
}

export async function inventoryCrates(root: string): Promise<Crate[]> {
  const top = Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as any;
  const ws = top.workspace?.dependencies ?? {};
  const members = await expandMembers(root, top.workspace?.members ?? [], top.workspace?.exclude ?? []);
  const crates: Crate[] = [];
  const byDir = new Map<string, Crate>();
  for (const dir of members) {
    const file = Bun.file(join(root, dir, "Cargo.toml"));
    if (!(await file.exists())) continue;
    const toml = Bun.TOML.parse(await file.text()) as any;
    if (!toml.package) continue;
    const deps = depsOf(toml.dependencies, ws);
    for (const [cfg, t] of Object.entries((toml.target ?? {}) as Record<string, any>))
      if (cfgMayMatchWasm(cfg)) deps.push(...depsOf(t.dependencies, ws));
    let hasWasmCfg = false;
    for await (const f of new Bun.Glob("src/**/*.rs").scan({ cwd: join(root, dir), onlyFiles: true })) {
      const text = await Bun.file(join(root, dir, f)).text();
      if (/target_(arch|family)\s*=\s*"wasm|target_os\s*=\s*"wasi/.test(text)) {
        hasWasmCfg = true;
        break;
      }
    }
    const crateTypes: string[] = toml.lib?.["crate-type"] ?? [];
    const c: Crate = {
      name: toml.package.name,
      dir,
      description: String(toml.package.description ?? "")
        .split("\n")[0]!
        .slice(0, 120),
      hasWasmCfg,
      wasmTarget: Object.keys(toml.target ?? {}).some(k => /wasm|wasi/.test(k)),
      cdylib: crateTypes.includes("cdylib"),
      deps,
      direct: [],
      via: [],
      verdict: "ok",
    };
    for (const d of deps) {
      if (d.internal) continue;
      const b = BLOCKERS[d.name];
      if (b && b.verdict !== "ok") c.direct.push({ name: d.name + (d.optional ? "?" : ""), ...b });
    }
    crates.push(c);
    byDir.set(resolve(root, dir), c);
  }
  // A crate is as blocked as its worst non-optional internal dependency.
  const rank = { ok: 0, adapt: 1, blocked: 2 } as const;
  const own = (c: Crate): Verdict =>
    c.direct.reduce<Verdict>((v, d) => {
      const dv: Verdict = d.name.endsWith("?") && d.verdict === "blocked" ? "adapt" : d.verdict;
      return rank[dv] > rank[v] ? dv : v;
    }, "ok");
  for (const c of crates) c.verdict = own(c);
  for (let changed = true; changed;) {
    changed = false;
    for (const c of crates) {
      for (const d of c.deps) {
        if (!d.internal) continue;
        const dep = byDir.get(resolve(root, c.dir, d.internal)) ?? byDir.get(resolve(root, d.internal));
        if (!dep) continue;
        const dv: Verdict = d.optional && dep.verdict === "blocked" ? "adapt" : dep.verdict;
        if (rank[dv] > rank[c.verdict]) {
          c.verdict = dv;
          changed = true;
        }
        if (dep.verdict !== "ok" && !c.via.includes(dep.name)) c.via.push(dep.name);
      }
    }
  }
  return crates;
}

const HOST_ONLY: [RegExp, Verdict, string][] = [
  [/from\s+["']bun:ffi["']/, "blocked", "bun:ffi (native .so/.dll): the matching crate as wasm"],
  [/\.node["']\)|napi/, "blocked", "N-API addon"],
  [/from\s+["'](node:)?child_process["']|Bun\.spawn(Sync)?\(/, "adapt", "processes: WebOS process table"],
  [/from\s+["'](node:)?(net|tls|dgram|dns)["']|Bun\.(listen|connect|udpSocket)\(/, "adapt", "sockets: fetch/WebSocket"],
  [/Bun\.serve\(/, "adapt", "server: Service Worker routes"],
  [/from\s+["']bun:sqlite["']/, "adapt", "bun:sqlite: SQLite wasm + OPFS"],
  [/from\s+["'](node:)?(fs|fs\/promises)["']|Bun\.(file|write)\(/, "adapt", "fs: WASI/OPFS VFS"],
  [/from\s+["'](node:)?(os|worker_threads|cluster)["']/, "adapt", "os/workers: navigator + Web Workers"],
];

export async function inventoryPackages(root: string): Promise<Pkg[]> {
  const pkgs: Pkg[] = [];
  for await (const f of new Bun.Glob("packages/**/package.json").scan({ cwd: root, onlyFiles: true })) {
    const rel = f.replaceAll("\\", "/");
    if (rel.includes("node_modules") || rel.split("/").length > 4) continue;
    const dir = dirname(rel);
    const json = await Bun.file(join(root, rel))
      .json()
      .catch(() => ({}));
    const hits = new Set<string>();
    let verdict: Verdict = "ok";
    for await (const s of new Bun.Glob("{src,lib}/**/*.{ts,tsx,js,mjs}").scan({
      cwd: join(root, dir),
      onlyFiles: true,
    })) {
      if (/\.test\.|\/test\//.test(s)) continue;
      const text = await Bun.file(join(root, dir, s)).text();
      for (const [re, v, why] of HOST_ONLY) {
        if (!re.test(text)) continue;
        hits.add(why);
        if (v === "blocked" || (v === "adapt" && verdict === "ok")) verdict = v === "blocked" ? "blocked" : "adapt";
      }
    }
    pkgs.push({ name: json.name ?? dir, dir, hits: [...hits], verdict });
  }
  return pkgs.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function toMarkdown(crates: Crate[], pkgs: Pkg[]): string {
  const label = { ok: "OK", adapt: "à adapter", blocked: "impossible en l'état" } as const;
  const count = (xs: { verdict: Verdict }[], v: Verdict) => xs.filter(x => x.verdict === v).length;
  const lines = [
    `Crates : ${crates.length} (OK ${count(crates, "ok")}, à adapter ${count(crates, "adapt")}, impossible ${count(crates, "blocked")}).`,
    `Packages : ${pkgs.length} (OK ${count(pkgs, "ok")}, à adapter ${count(pkgs, "adapt")}, impossible ${count(pkgs, "blocked")}).`,
    "",
    "| Crate | Dossier | wasm | cfg wasm | Raison (dépendances directes ; via crates internes) |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const c of [...crates].sort((a, b) => a.dir.localeCompare(b.dir))) {
    const why = [
      ...c.direct.map(d => `${d.name}: ${d.why}`),
      ...(c.via.length ? [`via ${c.via.slice(0, 4).join(", ")}${c.via.length > 4 ? "…" : ""}`] : []),
    ].join(" ; ");
    lines.push(
      `| ${c.name} | ${c.dir} | ${label[c.verdict]} | ${c.hasWasmCfg || c.wasmTarget || c.cdylib ? "oui" : ""} | ${why.replaceAll("|", "/")} |`,
    );
  }
  lines.push("", "| Package | Dossier | wasm | API hôte à remplacer |", "| --- | --- | --- | --- |");
  for (const p of pkgs) lines.push(`| ${p.name} | ${p.dir} | ${label[p.verdict]} | ${p.hits.join(" ; ")} |`);
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  const arg = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const root = resolve(arg("--root") ?? join(import.meta.dir, "../.."));
  const crates = await inventoryCrates(root);
  const pkgs = await Bun.file(join(root, "packages"))
    .exists()
    .then(() => inventoryPackages(root));
  const json = arg("--json");
  const md = arg("--md");
  if (json)
    await Bun.write(json, JSON.stringify({ root: relative(process.cwd(), root), crates, packages: pkgs }, null, 2));
  if (md) await Bun.write(md, toMarkdown(crates, pkgs));
  if (!json && !md) process.stdout.write(toMarkdown(crates, pkgs));
}
