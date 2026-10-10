// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json";
import { NativeInference } from "../src/inference";
import { NATIVE_ABI_VERSIONS, nativeHostTriple, nativeTargetLibc } from "../src/native-artifact";

const directories: string[] = [];
const previousLibrary = process.env.APHRODY_INFERENCE_LIBRARY;
const previousDevelopment = process.env.APHRODY_FFI_DEV;
afterEach(() => {
  process.env.APHRODY_INFERENCE_LIBRARY = previousLibrary;
  process.env.APHRODY_FFI_DEV = previousDevelopment;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function untrustedArtifact() {
  const directory = mkdtempSync(join(tmpdir(), "aphrody-inference-admission-"));
  directories.push(directory);
  const artifact =
    process.platform === "win32"
      ? "aphrody_ffi.dll"
      : process.platform === "darwin"
        ? "libaphrody_ffi.dylib"
        : "libaphrody_ffi.so";
  const path = join(directory, artifact);
  writeFileSync(path, "This file must never reach dlopen");
  process.env.APHRODY_INFERENCE_LIBRARY = path;
  delete process.env.APHRODY_FFI_DEV;
  return { directory, artifact, path };
}

test("standalone inference rejects an unmanifested library before loading native code", async () => {
  untrustedArtifact();
  await expect(
    NativeInference.open({ model: "fixture-model", profile: "aphrody" }),
  ).rejects.toThrow("Native manifest missing");
});

test("standalone inference rejects a changed release artifact before loading native code", async () => {
  const { directory, artifact, path } = untrustedArtifact();
  const target = nativeHostTriple();
  if (!target) throw new Error("Test requires a supported native host");
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      package: "@aphrody/bun",
      crate: "aphrody-ffi",
      version: "1.0.0",
      packageVersion: packageMetadata.version,
      target,
      libc: nativeTargetLibc(target),
      profile: "release",
      features: ["inference"],
      artifact,
      sha256: "a".repeat(64),
      bytes: Bun.file(path).size,
      abi: { ...NATIVE_ABI_VERSIONS },
      provenance: "cargo-build",
      buildSourceHead: "b".repeat(40),
      observedSourceHead: "b".repeat(40),
      observedSourceDirty: false,
      cargoLockSha256: "c".repeat(64),
      rustc: "rustc test fixture",
      consumerSmoke: "passed",
    }),
  );
  await expect(
    NativeInference.open({ model: "fixture-model", profile: "aphrody" }),
  ).rejects.toThrow("Native artifact hash/size mismatch");
});
