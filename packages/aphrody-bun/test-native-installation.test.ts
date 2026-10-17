// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { suffix } from "bun:ffi";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import metadata from "./package.json";
import {
  hashNativeArtifact,
  NATIVE_ABI_VERSIONS,
  nativeHostTriple,
  nativeTargetLibc,
  verifyNativeArtifact,
} from "./src/native-artifact";
import { resolveInstalledNativeLibraryPath } from "./src/native-installation";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "aphrody-installed-ffi-"));
  roots.push(home);
  const bin = join(home, ".local/bin");
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  return { home, alias: join(bin, "aphrody") };
}
function pin(home: string, version: string) {
  const directory = join(home, ".local/lib/aphrody", version);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const binary = join(directory, "aphrody");
  writeFileSync(binary, `CLI ${version}`, { mode: 0o700 });
  const artifact = join(directory, `libaphrody_ffi.${suffix}`);
  writeFileSync(artifact, `FFI ${version}`, { mode: 0o600 });
  const target = nativeHostTriple()!;
  const manifest = {
    schemaVersion: 1,
    package: "@aphrody/bun",
    crate: "aphrody-ffi",
    version: "1.0.0",
    packageVersion: metadata.version,
    target,
    libc: nativeTargetLibc(target),
    profile: "release",
    features: [],
    artifact: `libaphrody_ffi.${suffix}`,
    ...hashNativeArtifact(artifact),
    abi: NATIVE_ABI_VERSIONS,
    provenance: "cargo-build",
    buildSourceHead: "a".repeat(40),
    observedSourceHead: "a".repeat(40),
    observedSourceDirty: false,
    cargoLockSha256: "b".repeat(64),
    rustc: "rustc fixture",
    consumerSmoke: "passed",
  };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest), {
    mode: 0o600,
  });
  return { binary, artifact, directory, manifest };
}
const unix = test.skipIf(process.platform === "win32");

unix("canonical alias tracks pin upgrades and rollback without PATH or a process", () => {
  const f = fixture();
  const previous = pin(f.home, "old");
  const current = pin(f.home, "new");
  for (const selected of [previous, current, previous]) {
    if (resolveInstalledNativeLibraryPath(f.home)) unlinkSync(f.alias);
    symlinkSync(selected.binary, f.alias);
    expect(resolveInstalledNativeLibraryPath(f.home)).toBe(selected.artifact);
    expect(verifyNativeArtifact(selected.artifact, metadata.version)?.sha256).toBe(selected.manifest.sha256);
  }
});

unix("SDK resolver prefers an explicit override and then the canonical installed companion", () => {
  const f = fixture();
  const selected = pin(f.home, "pin");
  symlinkSync(selected.binary, f.alias);
  const resolver = join(import.meta.dir, "src/library.ts");
  for (const override of [undefined, selected.binary]) {
    const run = Bun.spawnSync({
      windowsHide: true,
      cmd: [
        process.execPath,
        "-e",
        `const { resolveNativeLibraryPath } = await import(${JSON.stringify(resolver)}); console.log(resolveNativeLibraryPath());`,
      ],
      env: {
        ...process.env,
        HOME: f.home,
        APHRODY_FFI_LIB: override,
        APHRODY_FFI_DEV: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    expect(run.stderr.toString()).toBe("");
    expect(run.stdout.toString().trim()).toBe(override ?? selected.artifact);
  }
});

unix("missing canonical installation and missing companion do not select foreign aliases", () => {
  const f = fixture();
  const selected = pin(f.home, "pin");
  symlinkSync(selected.binary, join(f.home, ".local/bin/aphrody-mcp"));
  expect(resolveInstalledNativeLibraryPath(f.home)).toBeUndefined();
  symlinkSync(selected.binary, f.alias);
  unlinkSync(selected.artifact);
  expect(resolveInstalledNativeLibraryPath(f.home)).toBeUndefined();
});

unix("an installed companion always requires a regular owned manifest", () => {
  const f = fixture();
  const selected = pin(f.home, "pin");
  symlinkSync(selected.binary, f.alias);
  const manifest = join(selected.directory, "manifest.json");
  unlinkSync(manifest);
  expect(() => resolveInstalledNativeLibraryPath(f.home)).toThrow("manifest is missing or invalid");
  symlinkSync(join(selected.directory, "absent-manifest"), manifest);
  expect(() => resolveInstalledNativeLibraryPath(f.home)).toThrow("manifest is missing or invalid");
  const target = join(f.home, "target/debug");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `libaphrody_ffi.${suffix}`), "development fallback");
  const resolver = join(import.meta.dir, "src/library.ts");
  const run = Bun.spawnSync({
    windowsHide: true,
    cmd: [
      process.execPath,
      "-e",
      `const { resolveNativeLibraryPath } = await import(${JSON.stringify(resolver)});
       try { resolveNativeLibraryPath(); throw new Error("fallback accepted"); }
       catch (error) { if (!error.message.includes("manifest is missing or invalid")) throw error; }`,
    ],
    env: {
      ...process.env,
      HOME: f.home,
      APHRODY_FFI_LIB: undefined,
      APHRODY_FFI_DEV: "1",
      CARGO_TARGET_DIR: join(f.home, "target"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({
    code: 0,
    stderr: "",
  });
});

unix("companion corruption and mismatched package or ABI fail verification", () => {
  const f = fixture();
  const selected = pin(f.home, "pin");
  symlinkSync(selected.binary, f.alias);
  for (const patch of [
    { packageVersion: "0.0.0" },
    { abi: { ...NATIVE_ABI_VERSIONS, aphrody_web_bridge_abi_version: 0 } },
    { observedSourceDirty: true },
  ]) {
    writeFileSync(join(selected.directory, "manifest.json"), JSON.stringify({ ...selected.manifest, ...patch }));
    expect(() => verifyNativeArtifact(resolveInstalledNativeLibraryPath(f.home)!, metadata.version)).toThrow(
      "Invalid native manifest",
    );
  }
  writeFileSync(join(selected.directory, "manifest.json"), JSON.stringify(selected.manifest));
  writeFileSync(selected.artifact, "corrupt");
  expect(() => verifyNativeArtifact(resolveInstalledNativeLibraryPath(f.home)!, metadata.version)).toThrow(
    "hash/size mismatch",
  );
});

unix("rejects unrelated canonical targets, writable pins and symlink companions", () => {
  const f = fixture();
  const selected = pin(f.home, "pin");
  const foreign = join(selected.directory, "yolo");
  writeFileSync(foreign, "foreign", { mode: 0o700 });
  symlinkSync(foreign, f.alias);
  expect(() => resolveInstalledNativeLibraryPath(f.home)).toThrow("unexpected binary");
  unlinkSync(f.alias);
  symlinkSync(selected.binary, f.alias);
  chmodSync(selected.directory, 0o777);
  expect(() => resolveInstalledNativeLibraryPath(f.home)).toThrow("not owner-controlled");
  chmodSync(selected.directory, 0o700);
  unlinkSync(selected.artifact);
  symlinkSync(foreign, selected.artifact);
  expect(() => resolveInstalledNativeLibraryPath(f.home)).toThrow("not a regular file");
});
