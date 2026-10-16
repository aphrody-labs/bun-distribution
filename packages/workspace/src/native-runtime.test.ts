// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireNativeRuntime, runNativeRuntime } from "./native-runtime.ts";

const consumer = resolve(import.meta.dir, "../../../docs/aphrody");
const yolo = resolve(consumer, "scripts/dev/cli/yolo");
const bunCheckout = process.env["APHRODY_BUN_CHECKOUT"];
const target = "x86_64-unknown-linux-gnu";
const nativeHome = join(homedir(), ".yolo/runtime", target);
const older = join(nativeHome, "0.1.0-3d585c67");
const newer = join(nativeHome, "0.1.0-ae14394b");
const abi13 = join(nativeHome, "0.1.0-7766c407");
const capabilities = [
  "system.stats",
  "bench.compute",
  "process.supervise",
  "http.probe",
];
const assetTest = test.skipIf(
  process.platform !== "linux" ||
    process.arch !== "x64" ||
    ![older, newer, abi13].every(existsSync) ||
    !bunCheckout,
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "native-runtime-consumer-"));
  temporary.push(root);
  const configuration = {
    requiredCapabilities: capabilities,
    artifacts: [
      {
        target,
        version: "0.1.0",
        abi: "1.4",
        revision: "0ade1c71ccb52bcc9d255188a252c28c5b789b48",
        manifestSha256:
          "8f0fb923d7f201d57ed28dd0cfc6b415a60b8cd6ea9ed8cfe75cb1142cffc6f1",
      },
      {
        target,
        version: "0.1.0",
        abi: "1.4",
        revision: "01300fb2f935f7fb85b135212c718131ae640ff5",
        manifestSha256:
          "24166c2e68c623e4b0c4370d9786f824099ccaf2ad031170cbe893906261737f",
      },
    ],
  };
  await mkdir(join(root, "tools", "config"), { recursive: true });
  await writeFile(
    join(root, "tools/config/native-runtime.json"),
    JSON.stringify(configuration),
  );
  return {
    root,
    runtimeHome: join(root, "installed/runtime"),
    yolo,
    bunCheckout,
    configuration,
  };
}
async function updateConfiguration(f: Awaited<ReturnType<typeof fixture>>) {
  await writeFile(
    join(f.root, "tools/config/native-runtime.json"),
    JSON.stringify(f.configuration),
  );
}
assetTest(
  "native install, upgrade and rollback load the exact real artifacts",
  async () => {
    const f = await fixture();
    const originalCurrent = await readlink(join(nativeHome, "current"));
    const originalPrevious = await readlink(join(nativeHome, "previous"));
    const preview = await acquireNativeRuntime({
      ...f,
      action: "install",
      artifact: older,
    });
    expect(preview).toMatchObject({
      applied: false,
      runtime: { build: { abi: "1.4", git_rev: "01300fb2f935" } },
    });
    expect(existsSync(f.runtimeHome)).toBe(false);

    const installed = await acquireNativeRuntime({
      ...f,
      action: "install",
      artifact: older,
      apply: true,
    });
    expect(installed.applied).toBe(true);
    expect(installed.runtime.revision).toBe(
      "01300fb2f935f7fb85b135212c718131ae640ff5",
    );
    expect(await readlink(join(f.runtimeHome, target, "current"))).toBe(
      "0.1.0-3d585c67",
    );

    const upgraded = await acquireNativeRuntime({
      ...f,
      action: "install",
      artifact: newer,
      apply: true,
    });
    expect(upgraded.runtime.build.git_rev).toBe("0ade1c71ccb5");
    expect(await readlink(join(f.runtimeHome, target, "previous"))).toBe(
      "0.1.0-3d585c67",
    );

    const rolledBack = await acquireNativeRuntime({
      ...f,
      action: "rollback",
      apply: true,
    });
    expect(rolledBack.runtime.manifestSha256).toBe(
      installed.runtime.manifestSha256,
    );
    const verified = await acquireNativeRuntime({ ...f, action: "verify" });
    expect(verified.runtime.build.git_rev).toBe("01300fb2f935");
    expect(verified.runtime.capabilities).toEqual(capabilities);
    expect(await readlink(join(nativeHome, "current"))).toBe(originalCurrent);
    expect(await readlink(join(nativeHome, "previous"))).toBe(originalPrevious);
  },
);

assetTest(
  "unapproved artifacts and tampered library bytes never activate",
  async () => {
    const f = await fixture();
    await expect(
      acquireNativeRuntime({
        ...f,
        action: "install",
        artifact: abi13,
        apply: true,
      }),
    ).rejects.toThrow(/not pinned/);
    expect(existsSync(join(f.runtimeHome, target, "current"))).toBe(false);
    const artifact = join(f.root, "damaged-artifact");
    await cp(newer, artifact, { recursive: true });
    const path = join(artifact, "libyolo_runtime.so");
    const bytes = await readFile(path);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(path, bytes);
    await expect(
      acquireNativeRuntime({ ...f, action: "install", artifact, apply: true }),
    ).rejects.toThrow(/Hash mismatch/);
    expect(existsSync(join(f.runtimeHome, target, "current"))).toBe(false);
    expect((await readFile(path))[0]).toBe(bytes[0]);
  },
);

assetTest(
  "the workspace SDK rejects a real ABI 1.3 library before install even if it is approved",
  async () => {
    const f = await fixture();
    const artifact = join(f.root, "abi13");
    await cp(abi13, artifact, { recursive: true });
    const manifestPath = join(artifact, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    // Test ABI negotiation independently of the dirty-build provenance refusal.
    manifest.sources.yolo.dirty = false;
    const bytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(manifestPath, bytes);
    f.configuration.artifacts.push({
      target,
      version: manifest.version,
      abi: manifest.abi,
      revision: manifest.sources.yolo.rev,
      manifestSha256: sha256(bytes),
    });
    await updateConfiguration(f);
    await expect(
      acquireNativeRuntime({ ...f, action: "install", artifact, apply: true }),
    ).rejects.toThrow(/SDK needs 1\.4/);
    expect(existsSync(join(f.runtimeHome, target, "current"))).toBe(false);
  },
);

assetTest(
  "rollback refuses an unapproved previous artifact and leaves both slots intact",
  async () => {
    const f = await fixture();
    await acquireNativeRuntime({
      ...f,
      action: "install",
      artifact: newer,
      apply: true,
    });
    const dir = join(f.runtimeHome, target);
    await cp(abi13, join(dir, "0.1.0-7766c407"), { recursive: true });
    await symlink("0.1.0-7766c407", join(dir, "previous"));
    await expect(
      acquireNativeRuntime({ ...f, action: "rollback", apply: true }),
    ).rejects.toThrow(/not pinned/);
    expect(await readlink(join(dir, "current"))).toBe("0.1.0-ae14394b");
    expect(await readlink(join(dir, "previous"))).toBe("0.1.0-7766c407");
  },
);

assetTest(
  "a concurrent acquisition lock is preserved and no install starts",
  async () => {
    const f = await fixture();
    const lock = join(f.runtimeHome, ".consumer-acquisition.lock");
    await mkdir(lock, { recursive: true });
    await writeFile(join(lock, "other-owner"), "active");
    await expect(
      acquireNativeRuntime({
        ...f,
        action: "install",
        artifact: newer,
        apply: true,
      }),
    ).rejects.toThrow(/EEXIST/);
    expect(await readFile(join(lock, "other-owner"), "utf8")).toBe("active");
    expect(existsSync(join(f.runtimeHome, target, "current"))).toBe(false);
  },
);

assetTest(
  "linked library files cannot replace another owner's data",
  async () => {
    const f = await fixture();
    const artifact = join(f.root, "linked-artifact");
    await cp(newer, artifact, { recursive: true });
    await rm(join(artifact, "libyolo_runtime.so"));
    await symlink(
      join(newer, "libyolo_runtime.so"),
      join(artifact, "libyolo_runtime.so"),
    );
    await expect(
      acquireNativeRuntime({ ...f, action: "install", artifact, apply: true }),
    ).rejects.toThrow(/regular runtime file/);
    expect(existsSync(join(f.runtimeHome, target, "current"))).toBe(false);
  },
);

assetTest(
  "missing capabilities are refused before native activation",
  async () => {
    const f = await fixture();
    f.configuration.requiredCapabilities = [...capabilities, "desktop.window"];
    await updateConfiguration(f);
    await expect(
      acquireNativeRuntime({
        ...f,
        action: "install",
        artifact: newer,
        apply: true,
      }),
    ).rejects.toThrow(/capabilities missing: desktop.window/);
    expect(existsSync(join(f.runtimeHome, target, "current"))).toBe(false);
  },
);

assetTest(
  "a damaged existing immutable slot is refused before current changes",
  async () => {
    const f = await fixture();
    await acquireNativeRuntime({
      ...f,
      action: "install",
      artifact: older,
      apply: true,
    });
    const destination = join(f.runtimeHome, target, "0.1.0-ae14394b");
    await cp(newer, destination, { recursive: true });
    const path = join(destination, "libyolo_runtime.so");
    const bytes = await readFile(path);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(path, bytes);
    await expect(
      acquireNativeRuntime({
        ...f,
        action: "install",
        artifact: newer,
        apply: true,
      }),
    ).rejects.toThrow(/Hash mismatch/);
    expect(await readlink(join(f.runtimeHome, target, "current"))).toBe(
      "0.1.0-3d585c67",
    );
    expect(existsSync(join(f.runtimeHome, target, "previous"))).toBe(false);
  },
);

test("CLI parsing refuses absent values and unknown options before acquisition", async () => {
  await expect(runNativeRuntime(["install", "--artifact"])).rejects.toThrow(
    /Missing value/,
  );
  await expect(runNativeRuntime(["verify", "--apply-now"])).rejects.toThrow(
    /Unknown option/,
  );
});
