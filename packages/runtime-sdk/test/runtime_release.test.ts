import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostTarget, loadArtifact, verifyArtifact } from "../../runtime/src/artifact";
import { install, list, rollback } from "../../../../scripts/release/runtime_release";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const packaged = join(root, "dist/runtime", hostTarget());
const available = existsSync(join(packaged, "manifest.json"));
const suite = available ? describe : describe.skip;

const sandbox = mkdtempSync(join(tmpdir(), "yolo-runtime-"));
let previousRuntimeHome: string | undefined;
let environmentChanged = false;
beforeAll(() => {
  previousRuntimeHome = process.env["YOLO_RUNTIME_HOME"];
  process.env["YOLO_RUNTIME_HOME"] = join(sandbox, "home");
  environmentChanged = true;
});
// Windows keeps a loaded library locked until the process exits: retry, then leave it to the OS temp cleanup.
afterAll(() => {
  if (environmentChanged) {
    if (previousRuntimeHome === undefined) delete process.env["YOLO_RUNTIME_HOME"];
    else process.env["YOLO_RUNTIME_HOME"] = previousRuntimeHome;
  }
  try {
    rmSync(sandbox, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {}
});

/** A second artifact version: same files, new version string. */
function variant(version: string): string {
  const dir = join(sandbox, `variant-${version}`);
  cpSync(packaged, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  manifest.version = version;
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

suite("runtime artifact verification, install and rollback", () => {
  it("verifies hashes, target and ABI, then loads the artifact", () => {
    const manifest = verifyArtifact(packaged);
    expect(manifest.target).toBe(hostTarget());
    using runtime = loadArtifact(packaged);
    expect(runtime.buildInfo().abi).toBe(manifest.abi);
  });

  it("rejects a tampered library before loading it", () => {
    const dir = variant("0.0.1-tampered");
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const lib = Object.keys(manifest.files).find(f => /\.(so|dylib|dll)$/.test(f)) as string;
    writeFileSync(join(dir, lib), new Uint8Array([1, 2, 3]));
    expect(() => verifyArtifact(dir)).toThrow(/Hash mismatch/);
    expect(() => loadArtifact(dir)).toThrow(/Hash mismatch/);
  });

  it("rejects an incompatible ABI major and a foreign target", () => {
    const abi = variant("0.0.2-abi");
    const m = JSON.parse(readFileSync(join(abi, "manifest.json"), "utf8"));
    m.compatibility.abiMajor = 2;
    writeFileSync(join(abi, "manifest.json"), JSON.stringify(m));
    expect(() => verifyArtifact(abi)).toThrow(/ABI major/);

    const foreign = variant("0.0.3-target");
    const f = JSON.parse(readFileSync(join(foreign, "manifest.json"), "utf8"));
    f.target = "riscv64gc-unknown-linux-gnu"; // never a supported host
    writeFileSync(join(foreign, "manifest.json"), JSON.stringify(f));
    expect(() => verifyArtifact(foreign)).toThrow(/targets/);
  });

  it("installs, keeps the previous artifact and rolls back", () => {
    const v1 = install(variant("1.0.0"));
    expect(list().find(e => e.name === v1)?.current).toBe(true);
    const v2 = install(variant("1.1.0"));
    expect(v2).not.toBe(v1);
    expect(list().find(e => e.name === v2)?.current).toBe(true);
    expect(list().find(e => e.name === v1)?.previous).toBe(true);

    // installing the active artifact again changes nothing
    expect(install(variant("1.1.0"))).toBe(v2);
    expect(list().find(e => e.name === v1)?.previous).toBe(true);

    expect(rollback().current).toBe(v1);
    expect(list().find(e => e.name === v1)?.current).toBe(true);
    expect(list().find(e => e.name === v2)?.previous).toBe(true);
    // the rolled-back artifact still loads
    using runtime = loadArtifact(join(process.env["YOLO_RUNTIME_HOME"] as string, hostTarget(), "current"));
    expect(runtime.capabilities()).toContain("system.stats");
  });

  it("refuses to roll back without a previous artifact", () => {
    rmSync(join(process.env["YOLO_RUNTIME_HOME"] as string, hostTarget(), "previous"), {
      force: true,
    });
    expect(() => rollback()).toThrow(/Nothing to roll back/);
  });
});
