#!/usr/bin/env bun
/**
 * Packages the precompiled runtime library into `dist/runtime/<target>/`:
 * the shared library, its C header and a manifest identifying target, toolchain, ABI, source
 * revisions, build options and hashes. It never starts Cargo: build first with
 * `just yolo::runtime-build` (profile `runtime`, unwinding panics).
 */
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { libraryFile, Runtime } from "../../packages/engine/runtime/src/index";
import { sha256 } from "../../packages/engine/core/src/sys/hash";

const root = resolve(import.meta.dir, "../..");
// A producer packages its build, independently of whichever version the user installed.
const libraryPath =
  process.env["YOLO_RUNTIME_LIB"] || resolve(root, "target/runtime", libraryFile());
if (!(await Bun.file(libraryPath).exists())) {
  console.error(`Missing ${libraryPath}: run \`just yolo::runtime-build\` first.`);
  process.exit(1);
}

async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? out.trim() : "unknown";
}

interface BuildInfo {
  name: string;
  version: string;
  abi: string;
  target: string;
  rustc: string;
  panic_recovery: boolean;
}

/**
 * Cross-built library (for example a Windows DLL built on the Linux factory): the library cannot be loaded here, so
 * `YOLO_RUNTIME_TARGET` names its target and the identity is read from what the build embeds and from the sources:
 * the PE export table must carry the whole ABI, the `rustc` and target strings come from the binary itself, and the
 * ABI, version and capabilities come from the crate that produced it (features `browser`, `tooling`).
 */
async function crossInfo(
  target: string,
  path: string,
): Promise<{ info: BuildInfo; capabilities: string[] }> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.startsWith("MZ")) throw new Error(`${path} is not a PE image`);
  const header = await Bun.file(resolve(root, "crates/engine/yolo-runtime/include/yolo_runtime.h")).text();
  for (const symbol of header.match(/\byolo_[a-z0-9_]+(?=\()/g) ?? []) {
    if (!text.includes(symbol)) throw new Error(`${path} does not export ${symbol}`);
  }
  if (!text.includes(target)) throw new Error(`${path} does not embed the target ${target}`);
  const rustc = text.match(/rustc \d+\.\d+\.\d+(?:-[a-z]+)? \([0-9a-f]{9} \d{4}-\d{2}-\d{2}\)/)?.[0];
  if (!rustc) throw new Error(`${path} embeds no rustc version`);
  const lib = await Bun.file(resolve(root, "crates/engine/yolo-runtime/src/lib.rs")).text();
  const major = lib.match(/pub const ABI_MAJOR: u32 = (\d+);/)?.[1];
  const minor = lib.match(/pub const ABI_MINOR: u32 = (\d+);/)?.[1];
  if (!major || !minor) throw new Error("ABI constants not found in yolo-runtime");
  const workspace = await Bun.file(resolve(root, "Cargo.toml")).text();
  const version = workspace.match(/\[workspace\.package\][^[]*?\nversion = "([^"]+)"/)?.[1];
  const caps = lib.slice(lib.indexOf("fn yolo_runtime_capabilities"));
  const block = caps.slice(caps.indexOf("&["), caps.indexOf("],"));
  const capabilities = [...block.matchAll(/"([a-z]+\.[a-z]+)"/g)].map((m) => m[1]!);
  if (!version || capabilities.length === 0) throw new Error("runtime version or capabilities not found");
  return {
    info: { name: "yolo-runtime", version, abi: `${major}.${minor}`, target, rustc, panic_recovery: true },
    capabilities,
  };
}

const crossTarget = process.env["YOLO_RUNTIME_TARGET"];
let info: BuildInfo;
let capabilities: string[];
if (crossTarget) {
  ({ info, capabilities } = await crossInfo(crossTarget, libraryPath));
} else {
  // Read what the library reports, then unload it: Windows refuses to open a loaded DLL.
  const loaded = Runtime.load({ libraryPath });
  info = loaded.buildInfo();
  capabilities = loaded.capabilities();
  loaded.close();
}
const outDir = resolve(root, "dist/runtime", info.target);
mkdirSync(outDir, { recursive: true });

const headerSrc = resolve(root, "crates/engine/yolo-runtime/include/yolo_runtime.h");
const libName = basename(libraryPath);
const lib = new Uint8Array(await Bun.file(libraryPath).arrayBuffer());
const header = new Uint8Array(await Bun.file(headerSrc).arrayBuffer());
await Bun.write(resolve(outDir, libName), lib);
await Bun.write(resolve(outDir, "yolo_runtime.h"), header);
await Bun.write(resolve(outDir, "LICENSE"), Bun.file(resolve(root, "LICENSE")));

const vendor = (await Bun.file(resolve(root, "vendor.lock")).json()) as {
  sources: { name: string; sha: string }[];
};
const manifest = {
  schema: 1,
  name: info.name,
  version: info.version,
  target: info.target,
  abi: info.abi,
  /** A consumer refuses the artifact before any native call unless its major matches. */
  compatibility: { abiMajor: Number(info.abi.split(".")[0]), negotiation: "yolo_abi_version" },
  toolchain: info.rustc,
  build: {
    command: "cargo build --profile runtime -p aphrody-ffi --features browser,tooling",
    profile: "runtime (release + panic=unwind)",
    panicRecovery: info.panic_recovery,
  },
  sources: {
    yolo: {
      rev: await git("rev-parse", "HEAD"),
      dirty: (await git("status", "--porcelain")) !== "",
    },
    vendored: vendor.sources,
  },
  capabilities,
  files: {
    [libName]: { sha256: sha256(lib), bytes: lib.byteLength },
    "yolo_runtime.h": { sha256: sha256(header), bytes: header.byteLength },
  },
  license: "MIT",
  notes:
    "Qualification, installation and activation are separate states; this manifest only identifies the artifact.",
};
await Bun.write(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Packaged ${info.name} ${info.version} (${info.target}, ABI ${info.abi}) -> ${outDir}`);
