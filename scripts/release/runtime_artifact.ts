#!/usr/bin/env bun
/**
 * Packages the precompiled runtime library into `dist/runtime/<target>/`:
 * the shared library, its C header and a manifest identifying target, toolchain, ABI, source
 * revisions, build options and hashes. It never starts Cargo: build first with
 * `just runtime-build` (profile `runtime`, unwinding panics).
 */
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { libraryFile, Runtime } from "../../packages/runtime/src/index";
import { sha256 } from "../../packages/core/src/sys/hash";

const root = resolve(import.meta.dir, "../..");
// A producer packages its build, independently of whichever version the user installed.
const libraryPath =
  process.env["YOLO_RUNTIME_LIB"] || resolve(root, "target/runtime", libraryFile());
if (!(await Bun.file(libraryPath).exists())) {
  console.error(`Missing ${libraryPath}: run \`just runtime-build\` first.`);
  process.exit(1);
}

async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? out.trim() : "unknown";
}

// Read what the library reports, then unload it: Windows refuses to open a loaded DLL.
const loaded = Runtime.load({ libraryPath });
const info = loaded.buildInfo();
const capabilities = loaded.capabilities();
loaded.close();
const outDir = resolve(root, "dist/runtime", info.target);
mkdirSync(outDir, { recursive: true });

const headerSrc = resolve(root, "crates/yolo-runtime/include/yolo_runtime.h");
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
    command: "cargo build --profile runtime -p yolo-runtime",
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
