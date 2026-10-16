// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  hashNativeArtifact,
  NATIVE_ABI_VERSIONS,
  nativeHostTriple,
  nativeTargetLibc,
  parseNativeArtifactManifest,
  type NativeArtifactManifest,
} from "./src/native-artifact";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), "aphrody-native-contract-"));
  directories.push(path);
  return path;
}
function manifest(artifact: string): NativeArtifactManifest {
  const target = nativeHostTriple();
  if (!target) throw new Error("Test requires a supported native host");
  return {
    schemaVersion: 1,
    package: "@aphrody/bun",
    crate: "aphrody-ffi",
    version: "0.1.0",
    packageVersion: "3.3.3",
    target,
    libc: nativeTargetLibc(target),
    profile: "release",
    features: [],
    artifact,
    sha256: "a".repeat(64),
    bytes: 1,
    abi: { ...NATIVE_ABI_VERSIONS },
    provenance: "cargo-build",
    buildSourceHead: "b".repeat(40),
    observedSourceHead: "b".repeat(40),
    observedSourceDirty: false,
    cargoLockSha256: "c".repeat(64),
    rustc: "rustc test fixture",
    consumerSmoke: "passed",
  };
}
function parse(data: NativeArtifactManifest, development = false) {
  return parseNativeArtifactManifest(
    data,
    data.artifact,
    "3.3.3",
    nativeHostTriple()!,
    development,
  );
}

test("release acceptance rejects wrong host, ABI, package and unqualified provenance", () => {
  const valid = manifest("libaphrody_ffi.so");
  expect(parse(valid)).toEqual(valid);
  for (const patch of [
    { target: "another-host" },
    { libc: valid.libc === "gnu" ? "musl" : "gnu" },
    { packageVersion: "0.0.0" },
    { abi: { ...valid.abi, aphrody_web_bridge_abi_version: 3 } },
    { sha256: "bad" },
    { observedSourceDirty: true },
    { buildSourceHead: null },
    { observedSourceHead: "d".repeat(40) },
    { consumerSmoke: "pending" },
  ])
    expect(() =>
      parse({ ...valid, ...patch } as NativeArtifactManifest),
    ).toThrow("Invalid native manifest");
});

test("existing debug artifacts require explicit development and retain unknown build fields", () => {
  const data: NativeArtifactManifest = {
    ...manifest("libaphrody_ffi.so"),
    profile: "debug",
    provenance: "existing-debug",
    version: null,
    features: null,
    buildSourceHead: null,
    observedSourceDirty: true,
    consumerSmoke: "pending",
  };
  expect(() => parse(data)).toThrow();
  expect(parse(data, true)).toEqual(data);
  expect(() => parse({ ...data, profile: "release" }, true)).toThrow(
    "restricted to debug",
  );
});

test("streamed hashing covers multiple chunks and detects changed content", () => {
  const path = join(temporary(), "artifact");
  const content = new Uint8Array(2 * 1024 * 1024 + 19).fill(7);
  writeFileSync(path, content);
  expect(hashNativeArtifact(path)).toEqual({
    bytes: content.length,
    sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
  });
  content[content.length - 1] = 8;
  writeFileSync(path, content);
  expect(hashNativeArtifact(path).sha256).toBe(
    new Bun.CryptoHasher("sha256").update(content).digest("hex"),
  );
});

async function isolated(
  code: string,
  env: Record<string, string | undefined>,
  cwd: string,
) {
  const child = Bun.spawn({
    windowsHide: true,
    cmd: [process.execPath, "-e", code],
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      APHRODY_FFI_DEV: undefined,
      APHRODY_FFI_LIB: undefined,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ stdout, stderr, exit }).toEqual({
    stdout: "ok\n",
    stderr: "",
    exit: 0,
  });
}

test("an installed package imports every public entry without checkout ancestors", async () => {
  const path = temporary();
  cpSync(join(import.meta.dir, "src"), join(path, "src"), { recursive: true });
  cpSync(join(import.meta.dir, "package.json"), join(path, "package.json"));
  // An installed package sees its declared dependencies (n2b re-exports @aphrody/runtime-sdk).
  const { dependencies = {} } = (await Bun.file(
    join(import.meta.dir, "package.json"),
  ).json()) as {
    dependencies?: Record<string, string>;
  };
  for (const name of Object.keys(dependencies)) {
    const target = dirname(
      Bun.resolveSync(`${name}/package.json`, import.meta.dir),
    );
    mkdirSync(dirname(join(path, "node_modules", name)), { recursive: true });
    symlinkSync(target, join(path, "node_modules", name), "dir");
  }
  await isolated(
    `
    for (const name of ["index", "cli", "web", "x", "svg", "render", "reproduce", "icons", "n2b", "oxc"])
      await import("./src/" + name + ".ts");
    const { nativeLibraryLoaded } = await import("./src/library.ts");
    if (nativeLibraryLoaded()) throw new Error("native code loaded on import");
    console.log("ok");
  `,
    {},
    path,
  );
});

test("checkout target lookup is opt-in and raw overrides need development mode", async () => {
  const path = temporary();
  const target = join(path, "target");
  const file =
    process.platform === "win32"
      ? "aphrody_ffi.dll"
      : process.platform === "darwin"
        ? "libaphrody_ffi.dylib"
        : "libaphrody_ffi.so";
  mkdirSync(join(target, "debug"), { recursive: true });
  const artifact = join(target, "debug", file);
  writeFileSync(artifact, "fixture");
  const library = JSON.stringify(join(import.meta.dir, "src/library.ts"));
  await isolated(
    `
    const { resolveNativeLibraryPath } = await import(${library});
    if (resolveNativeLibraryPath()) throw new Error("checkout lookup enabled by default");
    console.log("ok");
  `,
    { CARGO_TARGET_DIR: target },
    path,
  );
  await isolated(
    `
    const { resolveNativeLibraryPath } = await import(${library});
    if (resolveNativeLibraryPath() !== ${JSON.stringify(artifact)}) throw new Error("development target unavailable");
    console.log("ok");
  `,
    { CARGO_TARGET_DIR: target, APHRODY_FFI_DEV: "1" },
    path,
  );
  const verifier = JSON.stringify(
    join(import.meta.dir, "src/native-artifact.ts"),
  );
  await isolated(
    `
    const { verifyNativeArtifact } = await import(${verifier});
    try { verifyNativeArtifact(${JSON.stringify(artifact)}, "3.3.3"); throw new Error("raw override accepted"); }
    catch (error) { if (!error.message.includes("Native manifest missing")) throw error; }
    console.log("ok");
  `,
    {},
    path,
  );
  await isolated(
    `
    const { verifyNativeArtifact } = await import(${verifier});
    if (verifyNativeArtifact(${JSON.stringify(artifact)}, "3.3.3") !== undefined) throw new Error("unexpected manifest");
    console.log("ok");
  `,
    { APHRODY_FFI_DEV: "1" },
    path,
  );
});

test("artifact verification rejects corruption before native loading", async () => {
  const path = temporary();
  const artifact = join(path, "libaphrody_ffi.so");
  writeFileSync(artifact, "original");
  writeFileSync(
    join(path, "manifest.json"),
    JSON.stringify({
      ...manifest("libaphrody_ffi.so"),
      ...hashNativeArtifact(artifact),
    }),
  );
  writeFileSync(artifact, "tampered");
  const verifier = JSON.stringify(
    join(import.meta.dir, "src/native-artifact.ts"),
  );
  await isolated(
    `
    const { verifyNativeArtifact } = await import(${verifier});
    try { verifyNativeArtifact(${JSON.stringify(artifact)}, "3.3.3"); throw new Error("corruption accepted"); }
    catch (error) { if (!error.message.includes("hash/size mismatch")) throw error; }
    console.log("ok");
  `,
    {},
    path,
  );
});
