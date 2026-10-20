// SPDX-License-Identifier: MIT
import { afterEach, expect, test } from "bun:test";
import { chmod, cp, lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceIntegrity } from "../container/source-integrity.ts";
import {
  productModesSHA256,
  sourceEntries,
  validatePreparedProductPath,
  validateProductNativeInputs,
  validateProductWasmInputs,
  verifyInstalledAdditions,
  verifyLinks,
  verifySourceEntries,
} from "../container/product-payload.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bun-os-product-payload-"));
  roots.push(root);
  return root;
}

test.skipIf(process.platform !== "linux").each(["file", "directory", "root"])(
  "permission drift in a %s changes the product mode checksum without changing source bytes",
  async kind => {
    const root = await tempDir();
    await mkdir(join(root, "bin"));
    await Bun.write(join(root, "bin/command"), "#!/bin/sh\nexit 0\n");
    const target = kind === "root" ? root : kind === "directory" ? join(root, "bin") : join(root, "bin/command");
    await chmod(target, 0o755);
    const bytesBefore = await sourceIntegrity(root);
    const modesBefore = await productModesSHA256(root);

    await chmod(target, 0o700);

    expect((await sourceIntegrity(root)).treeSHA256).toBe(bytesBefore.treeSHA256);
    expect(await productModesSHA256(root)).not.toBe(modesBefore);
  },
);

test.skipIf(process.platform !== "linux")("original source fixture links remain literal, including dangling external targets", async () => {
  const root = await tempDir();
  const absentTarget = join(await tempDir(), "not-present");
  await symlink(absentTarget, join(root, "tracked-fixture"));
  const original = await sourceEntries(root);
  expect(original).toContainEqual(["tracked-fixture", "symlink", absentTarget]);

  await verifyLinks(root, original);
  await verifySourceEntries(root, original);
  expect((await lstat(join(root, "tracked-fixture"))).isSymbolicLink()).toBe(true);
  expect(await readlink(join(root, "tracked-fixture"))).toBe(absentTarget);

  await rm(join(root, "tracked-fixture"));
  await symlink("different-missing-target", join(root, "tracked-fixture"));
  await expect(verifyLinks(root, original)).rejects.toThrow("Frozen source symlink changed");
});

test.skipIf(process.platform !== "linux").each(["escaping", "absolute", "dangling"])(
  "new installed %s dependency links are rejected",
  async kind => {
    const sandbox = await tempDir();
    const root = join(sandbox, "product");
    await mkdir(root);
    const original = await sourceEntries(root);
    await Bun.write(join(sandbox, "outside.js"), "export {};\n");
    await Bun.write(join(root, "inside.js"), "export {};\n");
    await mkdir(join(root, "node_modules"));
    const target = kind === "escaping" ? "../../outside.js"
      : kind === "absolute" ? join(root, "inside.js") : "missing.js";
    await symlink(target, join(root, "node_modules/dependency"));

    await expect(verifyLinks(root, original)).rejects.toThrow();
  },
);

test.skipIf(process.platform !== "linux")("relative installed dependencies remain valid when the product tree is relocated", async () => {
  const sandbox = await tempDir();
  const originalRoot = join(sandbox, "original");
  await mkdir(join(originalRoot, "packages/library"), { recursive: true });
  await Bun.write(join(originalRoot, "packages/library/index.js"), "export const value = 42;\n");
  const original = await sourceEntries(originalRoot);
  await mkdir(join(originalRoot, "node_modules"));
  await symlink("../packages/library", join(originalRoot, "node_modules/library"));
  await verifyLinks(originalRoot, original);
  await verifyInstalledAdditions(originalRoot, original, []);

  const relocated = join(sandbox, "relocated");
  await cp(originalRoot, relocated, { recursive: true, dereference: false, verbatimSymlinks: true });
  await rm(originalRoot, { recursive: true });

  await verifyLinks(relocated, original);
  await verifySourceEntries(relocated, original);
  await verifyInstalledAdditions(relocated, original, []);
  expect(await readlink(join(relocated, "node_modules/library"))).toBe("../packages/library");
  expect(await Bun.file(join(relocated, "node_modules/library/index.js")).text()).toContain("value = 42");
});

test("prepared build inputs require a declared root member and cannot overwrite frozen source", async () => {
  const root = await tempDir();
  await Bun.write(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
  for (const name of ["declared", "undeclared"]) {
    await mkdir(join(root, "packages", name, "dist"), { recursive: true });
    await Bun.write(join(root, "packages", name, "package.json"), JSON.stringify({ name }));
  }
  await mkdir(join(root, "packages/cli-wasm/wasm"), { recursive: true });
  await Bun.write(join(root, "packages/cli-wasm/package.json"), JSON.stringify({
    name: "@aphrody/cli-wasm",
    imports: { "#cli-wasm-glue": "./wasm/aphrody_command_wasm.js" },
  }));
  await Bun.write(join(root, "packages/declared/dist/tracked.js"), "export const tracked = true;\n");
  const original = await sourceEntries(root);

  await validatePreparedProductPath(root, "packages/declared/dist/generated.js", original);
  await expect(validatePreparedProductPath(root, "packages/undeclared/dist/generated.js", original))
    .rejects.toThrow("declared root workspace member");
  await expect(validatePreparedProductPath(root, "packages/absent/dist/generated.js", original))
    .rejects.toThrow("no frozen workspace manifest");
  await expect(validatePreparedProductPath(root, "packages/declared/dist/tracked.js", original))
    .rejects.toThrow("replaces frozen source");
  await validatePreparedProductPath(root, "packages/cli-wasm/wasm/aphrody_command_wasm_bg.wasm", original);
  await expect(validatePreparedProductPath(root, "packages/declared/wasm/unowned.wasm", original))
    .rejects.toThrow("generated artifact of the declared CLI-WASM owner");
  await expect(validatePreparedProductPath(root, "packages/cli-wasm/wasm/unlisted.wasm", original))
    .rejects.toThrow("generated artifact of the declared CLI-WASM owner");
  const wasmInputs = [
    "packages/cli-wasm/wasm/aphrody_command_wasm.js",
    "packages/cli-wasm/wasm/aphrody_command_wasm.d.ts",
    "packages/cli-wasm/wasm/aphrody_command_wasm_bg.wasm",
    "packages/cli-wasm/wasm/aphrody_command_wasm_bg.wasm.d.ts",
    "packages/cli-wasm/wasm/provenance.json",
  ].map(path => ({ path }));
  await expect(validateProductWasmInputs(root, wasmInputs.slice(0, -1)))
    .rejects.toThrow("missing required CLI-WASM inputs");
  await validateProductWasmInputs(root, wasmInputs);
  expect(await Bun.file(join(root, "packages/declared/dist/tracked.js")).text()).toBe("export const tracked = true;\n");

  const path = "packages/declared/dist/generated.js";
  await Bun.write(join(root, path), "export const generated = true;\n");
  await verifyInstalledAdditions(root, original, [{ path }]);
  await expect(verifyInstalledAdditions(root, original, [])).rejects.toThrow("non-dependency product path");
});

test.skipIf(process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))(
  "product FFI inputs must match the native target, clean release manifest and artifact hash",
  async () => {
    const root = await tempDir();
    const target = process.arch === "x64" ? "linux-x64" : "linux-arm64";
    const triple = target === "linux-x64" ? "x86_64-unknown-linux-gnu" : "aarch64-unknown-linux-gnu";
    const directory = join(root, "packages/aphrody-bun/native", triple);
    await mkdir(directory, { recursive: true });
    const helperDirectory = join(root, "packages/aphrody-bun/src");
    await mkdir(helperDirectory, { recursive: true });
    await Bun.write(join(helperDirectory, "native-artifact.ts"), await Bun.file(join(import.meta.dir, "../packages/aphrody-bun/src/native-artifact.ts")).bytes());
    await Bun.write(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    await Bun.write(join(root, "packages/aphrody-bun/package.json"), JSON.stringify({ name: "@aphrody/bun", version: "1.4.4" }));
    const cargoLock = "# test lockfile\n";
    await Bun.write(join(root, "Cargo.lock"), cargoLock);
    const cargoLockSha256 = new Bun.CryptoHasher("sha256").update(cargoLock).digest("hex");
    const original = await sourceEntries(root);
    const artifact = new Uint8Array([1, 2, 3, 4, 5]);
    await Bun.write(join(directory, "libaphrody_ffi.so"), artifact);
    const manifest = {
      schemaVersion: 1,
      package: "@aphrody/bun",
      crate: "aphrody-ffi",
      version: "0.1.0",
      packageVersion: "1.4.4",
      target: triple,
      libc: "gnu",
      profile: "release",
      features: ["gpu"],
      artifact: "libaphrody_ffi.so",
      sha256: new Bun.CryptoHasher("sha256").update(artifact).digest("hex"),
      bytes: artifact.length,
      abi: {
        aphrody_abi_version: 1,
        aphrody_web_bridge_abi_version: 5,
        bun_rs_abi_version: 1,
        node2bun_abi_version: 2,
        aphrody_oxc_abi_version: 1,
      },
      provenance: "cargo-build",
      buildSourceHead: "a".repeat(40),
      observedSourceHead: "a".repeat(40),
      observedSourceDirty: false,
      cargoLockSha256,
      rustc: "rustc 1.90.0",
      consumerSmoke: "passed",
    };
    await Bun.write(join(directory, "manifest.json"), JSON.stringify(manifest));
    const inputs = [
      { path: `packages/aphrody-bun/native/${triple}/libaphrody_ffi.so` },
      { path: `packages/aphrody-bun/native/${triple}/manifest.json` },
    ];
    const otherTarget = target === "linux-x64" ? "linux-arm64" : "linux-x64";
    await validateProductNativeInputs(root, inputs, original, target, "a".repeat(40));
    await expect(validateProductNativeInputs(root, inputs, original, otherTarget, "a".repeat(40)))
      .rejects.toThrow("missing required native FFI input");
    await expect(validateProductNativeInputs(root, inputs, original, target, "c".repeat(40)))
      .rejects.toThrow("provenance does not match");
    await Bun.write(join(directory, "libaphrody_ffi.so"), new Uint8Array([9]));
    await expect(validateProductNativeInputs(root, inputs, original, target, "a".repeat(40)))
      .rejects.toThrow("artifact does not match its release manifest");
  },
);
