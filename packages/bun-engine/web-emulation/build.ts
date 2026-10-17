#!/usr/bin/env bun
/**
 * Web emulation build pipeline: Rust cores (bun-engine `web` feature) to optimized WebAssembly,
 * Qt front ends through the pinned Emscripten/Qt container, the open-source firmware set, and
 * the manifests play.aphrody.app reads. Layout and schema: ./README.md.
 *
 *   bun packages/bun-engine/web-emulation/build.ts rust [core...] [--threads]
 *   bun packages/bun-engine/web-emulation/build.ts qt melonds
 *   bun packages/bun-engine/web-emulation/build.ts index
 *
 * Docker steps wait for other docker builds (sequential); cargo goes through the slot-limited wrapper.
 */
import { brotliCompressSync, constants } from "node:zlib";
import { join, relative, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";

const here = import.meta.dir;
const root = resolve(here, "../../..");
const dist = join(root, "dist", "web-emulation");
const work = join(root, "build", "web-emulation");
const lock = await Bun.file(join(here, "web-emulation.lock.json")).json();

interface RustCore {
  name: string;
  features: string[];
  systems: string[];
  extensions: string[];
  touch: boolean;
  firmware: string[];
  license: string;
}

/** Rust cores, in the owner's priority order (DS and 3DS first). */
export const rustCores: Record<string, RustCore> = {
  "dust-nds": {
    name: "Dust (Nintendo DS)",
    features: ["nds"],
    systems: ["nds"],
    extensions: [".nds", ".srl"],
    touch: true,
    firmware: [],
    license: "GPL-3.0-or-later",
  },
  "zakuro-3ds": {
    name: "Zakuro (Nintendo 3DS, software PICA)",
    features: ["ctr"],
    systems: ["3ds", "ctr"],
    extensions: [".3dsx", ".cia", ".cxi", ".cci", ".3ds"],
    touch: true,
    firmware: [],
    license: "MIT",
  },
  "tetanes-nes": {
    name: "TetaNES (NES)",
    features: ["nes"],
    systems: ["nes"],
    extensions: [".nes"],
    touch: false,
    firmware: [],
    license: "MIT OR Apache-2.0",
  },
  "rustboyadvance-gba": {
    name: "RustBoyAdvance-NG (Game Boy Advance)",
    features: ["gba"],
    systems: ["gba"],
    extensions: [".gba"],
    touch: false,
    firmware: ["normmatt-gba-bios"],
    license: "MIT",
  },
  "starpsx-psx": {
    name: "StarPSX (PlayStation)",
    features: ["psx"],
    systems: ["psx"],
    extensions: [".exe", ".bin", ".iso"],
    touch: false,
    firmware: ["openbios"],
    license: "GPL-3.0-or-later",
  },
};

const baseFeatures = lock.rust.targetFeatures.base as string[];

function log(message: string) {
  console.log(
    `[web-emulation ${new Date().toISOString().slice(11, 19)}] ${message}`,
  );
}

/**
 * Docker builds count against the shared workstation's load and stay sequential: wait until no
 * other docker build/run is active. Cargo needs no wait; the cargo wrapper admits a bounded number
 * of concurrent builds and queues the rest.
 */
export async function waitForDocker(what: string) {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name like 'docker%'\" | ? { $_.CommandLine -match ' build | run ' } | Measure-Object | % Count";
  let announced = false;
  for (;;) {
    const out =
      process.platform === "win32"
        ? Bun.spawnSync(["powershell", "-NoProfile", "-Command", script]).stdout.toString()
        : Bun.spawnSync(["sh", "-c", "pgrep -fc 'docker (build|run)' || true"]).stdout.toString();
    if (!out.split(/\s+/).filter(Boolean).map(Number).some((n) => n > 0)) return;
    if (!announced) log(`waiting for another docker build before ${what}`);
    announced = true;
    await Bun.sleep(20_000);
  }
}

async function run(
  cmd: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  const started = performance.now();
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(`${cmd.slice(0, 6).join(" ")} ... exited with ${code}`);
  return (performance.now() - started) / 1000;
}

async function sha256(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** Download a pinned tool archive, verify it and unpack it once. */
async function tool(
  name: "wasm-bindgen" | "binaryen",
  exe: string,
): Promise<string> {
  const pin = lock.tools[name];
  const dir = join(work, "tools", `${name}-${pin.version}`);
  const found = existsSync(dir) ? findFile(dir, exe) : undefined;
  if (found) return found;
  mkdirSync(dir, { recursive: true });
  log(`fetching ${name} ${pin.version}`);
  const response = await fetch(pin.url);
  if (!response.ok)
    throw new Error(`${name}: download failed (${response.status})`);
  const bytes = await response.bytes();
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (digest !== pin.sha256)
    throw new Error(
      `${name}: sha256 ${digest} does not match the lock (${pin.sha256})`,
    );
  await new Bun.Archive(bytes).extract(dir);
  const path = findFile(dir, exe);
  if (!path) throw new Error(`${name}: ${exe} not found in the archive`);
  return path;
}

function findFile(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(path, name);
      if (nested) return nested;
    } else if (entry.name === name) return path;
  }
}

function sizes(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return {
    bytes: bytes.length,
    gzip: Bun.gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

/** Build one Rust core variant: cargo (fat LTO) -> wasm-bindgen -> wasm-opt -O3 -> strip. */
async function buildRust(id: string, core: RustCore, threads: boolean) {
  const variant = threads ? "threads" : "single";
  const features = ["web", ...core.features];
  const targetFeatures = threads
    ? [...baseFeatures, ...lock.rust.targetFeatures.threads]
    : baseFeatures;
  const rustflags = [
    `-Ctarget-feature=${targetFeatures.map((f) => `+${f}`).join(",")}`,
  ];
  const cargo = [
    "build",
    "-p",
    "bun-engine",
    "--lib",
    "--target",
    "wasm32-unknown-unknown",
    "--profile",
    lock.rust.profile,
    "--no-default-features",
    "--features",
    features.join(","),
    "--target-dir",
    join(work, `rust-${variant}`),
  ];
  if (threads) {
    cargo.push("-Zbuild-std=panic_abort,std");
    rustflags.push(
      "-Clink-arg=--shared-memory",
      "-Clink-arg=--import-memory",
      "-Clink-arg=--max-memory=4294967296",
      "-Clink-arg=--export=__wasm_init_tls",
      "-Clink-arg=--export=__tls_size",
      "-Clink-arg=--export=__tls_align",
      "-Clink-arg=--export=__tls_base",
    );
  }
  log(`cargo ${id} (${variant}): ${features.join(",")}`);
  const cargoSeconds = await run(
    [
      "bun",
      "msvc",
      "exec",
      "--toolset",
      "14.44",
      "--",
      "bun",
      "scripts/cargo.ts",
      "exec",
      "--",
      ...cargo,
    ],
    {
      env: {
        CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: rustflags.join(" "),
        CARGO_BUILD_BUILD_DIR: join(work, `rust-${variant}`, "build"),
        // sccache passes web-sys's ~1,500 --cfg flags on a command line Windows rejects
        // (os error 206); compile these crates without the wrapper.
        RUSTC_WRAPPER: "",
        CARGO_BUILD_RUSTC_WRAPPER: "",
      },
    },
  );
  const raw = join(
    work,
    `rust-${variant}`,
    "wasm32-unknown-unknown",
    lock.rust.profile,
    "bun_engine.wasm",
  );
  const out = join(work, "out", id, variant);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const bindgen = await tool(
    "wasm-bindgen",
    process.platform === "win32" ? "wasm-bindgen.exe" : "wasm-bindgen",
  );
  const bindgenSeconds = await run([
    bindgen,
    "--target",
    "web",
    "--out-dir",
    out,
    "--out-name",
    "bun_engine",
    "--no-typescript",
    raw,
  ]);
  const wasmOpt = await tool(
    "binaryen",
    process.platform === "win32" ? "wasm-opt.exe" : "wasm-opt",
  );
  const bound = join(out, "bun_engine_bg.wasm");
  const optimized = join(out, "bun_engine_opt.wasm");
  const enable = targetFeatures.map((f) =>
    f === "atomics"
      ? "--enable-threads"
      : f === "nontrapping-fptoint"
        ? "--enable-nontrapping-float-to-int"
        : f === "simd128"
          ? "--enable-simd"
          : `--enable-${f}`,
  );
  const optSeconds = await run([
    wasmOpt,
    "-O3",
    ...enable,
    "--strip-debug",
    "--strip-producers",
    "--strip-target-features",
    bound,
    "-o",
    optimized,
  ]);
  const before = sizes(bound);
  const target = join(dist, id, threads ? "threads" : "");
  mkdirSync(target, { recursive: true });
  await Bun.write(join(target, "bun_engine_bg.wasm"), Bun.file(optimized));
  await Bun.write(
    join(target, "bun_engine.js"),
    Bun.file(join(out, "bun_engine.js")),
  );
  for (const extra of readdirSync(out).filter((f) =>
    f.startsWith("snippets"),
  )) {
    await run(["cp", "-r", join(out, extra), target]);
  }
  return {
    variant,
    threads,
    features,
    rustflags,
    seconds: {
      cargo: cargoSeconds,
      wasmBindgen: bindgenSeconds,
      wasmOpt: optSeconds,
    },
    size: {
      cargo: statSync(raw).size,
      wasmBindgen: before,
      wasmOpt: sizes(join(target, "bun_engine_bg.wasm")),
    },
    wasm: relative(
      join(dist, id),
      join(target, "bun_engine_bg.wasm"),
    ).replaceAll("\\", "/"),
    module: relative(join(dist, id), join(target, "bun_engine.js")).replaceAll(
      "\\",
      "/",
    ),
    sha256: {
      wasm: await sha256(join(target, "bun_engine_bg.wasm")),
      module: await sha256(join(target, "bun_engine.js")),
    },
  };
}

async function writeManifest(id: string, manifest: Record<string, unknown>) {
  await Bun.write(
    join(dist, id, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function rust(ids: string[], threads: boolean) {
  const report: Record<string, unknown> = (await Bun.file(
    join(dist, "report.json"),
  ).exists())
    ? await Bun.file(join(dist, "report.json")).json()
    : {};
  for (const id of ids) {
    const core = rustCores[id];
    if (!core)
      throw new Error(
        `unknown Rust core ${id} (${Object.keys(rustCores).join(", ")})`,
      );
    try {
      const single = await buildRust(id, core, false);
      const multi = threads ? await buildRust(id, core, true) : undefined;
      await writeManifest(id, {
        schemaVersion: 1,
        id,
        name: core.name,
        kind: "rust",
        systems: core.systems,
        extensions: core.extensions,
        module: single.module,
        wasm: single.wasm,
        start: "start",
        threads: false,
        renderer: "webgpu",
        touch: core.touch,
        audio: "bevy_audio",
        engine: "bevy",
        firmware: core.firmware,
        license: core.license,
        version: (
          await Bun.file(
            join(root, "crates", "bun-engine-core", "Cargo.toml"),
          ).text()
        ).match(/^version = "([^"]+)"/m)?.[1],
        sha256: single.sha256,
        variants: multi
          ? {
              threads: {
                module: multi.module,
                wasm: multi.wasm,
                threads: true,
                sha256: multi.sha256,
              },
            }
          : {},
      });
      report[id] = {
        kind: "rust",
        ok: true,
        builtAt: new Date().toISOString(),
        single,
        threads: multi,
      };
    } catch (error) {
      report[id] = {
        kind: "rust",
        ok: false,
        error: String(error),
        builtAt: new Date().toISOString(),
      };
      log(`${id} failed: ${error}`);
    }
    await Bun.write(
      join(dist, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  await index();
}

/** Qt front ends through the pinned container (melonDS first). */
async function qt(ids: string[]) {
  const image = lock.docker.images["qt-wasm"].ref;
  const report: Record<string, unknown> = (await Bun.file(
    join(dist, "report.json"),
  ).exists())
    ? await Bun.file(join(dist, "report.json")).json()
    : {};
  for (const id of ids) {
    if (id !== "melonds")
      throw new Error(`no Qt recipe for ${id}; see README (Qt cores)`);
    const out = join(work, "qt", id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    await waitForDocker(`docker ${id}`);
    log(`docker build of ${id}`);
    const seconds = await run([
      "docker",
      "run",
      "--rm",
      "-v",
      `${join(root, "vendor", "melonds")}:/src/melonds:ro`,
      "-v",
      `${join(here, "qt", "patches")}:/patches:ro`,
      "-v",
      `${join(here, "qt", "build-melonds.sh")}:/usr/local/bin/build-melonds.sh:ro`,
      "-v",
      `${out}:/out`,
      // Build trees persist in a named volume so iterations stay incremental.
      "-v",
      "bun-os-qt-work:/work",
      image,
      "bash",
      "/usr/local/bin/build-melonds.sh",
    ]);
    const target = join(dist, "melonds");
    mkdirSync(target, { recursive: true });
    for (const file of readdirSync(out))
      await Bun.write(join(target, file), Bun.file(join(out, file)));
    await Bun.write(
      join(target, "melonds.js"),
      Bun.file(join(here, "runtime", "melonds.js")),
    );
    const build = await Bun.file(join(out, "build.json")).json();
    const files = Object.fromEntries(
      await Promise.all(
        readdirSync(target)
          .filter((f) => /\.(wasm|js)$/.test(f))
          .map(async (f) => [
            f,
            {
              ...sizes(join(target, f)),
              sha256: await sha256(join(target, f)),
            },
          ]),
      ),
    );
    await writeManifest("melonds", {
      schemaVersion: 1,
      id: "melonds",
      name: "melonDS (Nintendo DS, Qt 6 front end)",
      kind: "qt-emscripten",
      systems: ["nds"],
      extensions: [".nds", ".srl", ".dsi"],
      module: "melonds.js",
      wasm: "melonDS.wasm",
      start: "start",
      threads: true,
      renderer: "qt-raster",
      touch: true,
      audio: "sdl2-webaudio",
      firmware: [],
      license: "GPL-3.0-or-later",
      version: lock.sources.melonds.commit.slice(0, 12),
      build,
      files,
    });
    report.melonds = {
      kind: "qt",
      ok: true,
      seconds: { docker: seconds },
      files,
      build,
    };
    await Bun.write(
      join(dist, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  await index();
}

/** Open-source firmware served next to the cores, plus the index the page reads. */
async function index() {
  const registry = await Bun.file(
    join(
      root,
      "packages",
      "bun-engine",
      "plugins",
      "consoles",
      "free-firmware.json",
    ),
  ).json();
  const mirrors = await Bun.file(
    join(root, "packages", "bun-engine", "plugins", "consoles", "mirrors.json"),
  ).json();
  const firmware: Record<string, unknown> = {};
  mkdirSync(join(dist, "firmware"), { recursive: true });
  for (const [id, entry] of Object.entries<any>(registry.firmware)) {
    let source = entry.path
      ? join(root, entry.path)
      : join(work, "firmware", entry.file);
    if (!existsSync(source) && entry.url) {
      const response = await fetch(entry.url);
      if (response.ok) await Bun.write(source, await response.bytes());
    }
    if (!existsSync(source)) continue;
    const digest = new Bun.CryptoHasher("sha512")
      .update(await Bun.file(source).bytes())
      .digest("hex");
    if (entry.sha512 && digest !== entry.sha512)
      throw new Error(`${id}: sha512 mismatch; refusing to publish it`);
    await Bun.write(join(dist, "firmware", entry.file), Bun.file(source));
    const service = entry.mirror
      ? mirrors.services[entry.mirror.service]
      : undefined;
    firmware[id] = {
      console: entry.console,
      file: entry.file,
      size: entry.size,
      sha256: entry.sha256,
      sha512: entry.sha512,
      integrity: `sha512-${Buffer.from(digest, "hex").toString("base64")}`,
      license: entry.license,
      source: entry.source,
      // Same origin first (always CORS-clean), then the registry URL, then the mirror order.
      urls: [
        `firmware/${entry.file}`,
        ...(entry.url ? [entry.url] : []),
        ...(service?.urls ?? []).map(
          (base: string) => `${base}${entry.mirror.path}`,
        ),
      ].filter((url, i, all) => all.indexOf(url) === i),
    };
  }
  await Bun.write(
    join(dist, "firmware", "firmware.json"),
    `${JSON.stringify({ schemaVersion: 1, firmware }, null, 2)}\n`,
  );
  mkdirSync(join(dist, "runtime"), { recursive: true });
  for (const file of readdirSync(join(here, "runtime"))) {
    await Bun.write(
      join(dist, "runtime", file),
      Bun.file(join(here, "runtime", file)),
    );
  }
  const manifests = [];
  for (const entry of readdirSync(dist, { withFileTypes: true })) {
    const path = join(dist, entry.name, "manifest.json");
    if (entry.isDirectory() && existsSync(path))
      manifests.push(await Bun.file(path).json());
  }
  await Bun.write(
    join(dist, "index.json"),
    `${JSON.stringify({ schemaVersion: 1, cores: manifests }, null, 2)}\n`,
  );
  log(`index: ${manifests.map((m) => m.id).join(", ") || "no cores"}`);
}

if (import.meta.main) {
  const [command = "index", ...rest] = Bun.argv.slice(2);
  const args = rest.filter((a) => !a.startsWith("--"));
  if (command === "rust")
    await rust(
      args.length ? args : Object.keys(rustCores),
      rest.includes("--threads"),
    );
  else if (command === "qt") await qt(args.length ? args : ["melonds"]);
  else if (command === "index") await index();
  else
    throw new Error(
      "usage: build.ts rust [core...] [--threads] | qt [melonds] | index",
    );
}
