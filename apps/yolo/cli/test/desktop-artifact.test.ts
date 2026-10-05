import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopFile,
  inspectDesktopBinary,
  installDesktopArtifact,
  verifyDesktopArtifact,
  writeDesktopManifest,
  type DesktopManifest,
} from "../../../../packages/engine/runtime/src/desktop-artifact";
import { hostTarget } from "../../../../packages/engine/runtime/src/target";
const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { force: true, recursive: true });
});
const temp = (): string => {
  const path = mkdtempSync(join(tmpdir(), "yolo-desktop-integrity-"));
  owned.push(path);
  return path;
};
function fixture(): { path: string; manifest: DesktopManifest } {
  const path = temp();
  const bytes = new TextEncoder().encode("not executable; integrity-only hostile-input fixture");
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const revision = "1".repeat(40);
  const manifest: DesktopManifest = {
    schema: "yolo.desktop-artifact/1",
    name: "yolo-desktop",
    protocol: "yolo.desktop/1",
    version: "0.1.0",
    target: hostTarget(),
    executable: desktopFile(),
    files: { [desktopFile()]: { bytes: bytes.length, sha256 } },
    source: { revision, dirty: false },
    build: {
      name: "yolo-desktop",
      protocol: "yolo.desktop/1",
      version: "0.1.0",
      target: hostTarget(),
      git_rev: revision,
      rustc: "fixture",
      panic_recovery: true,
      engine: "system-webview",
    },
  };
  writeFileSync(join(path, desktopFile()), bytes);
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
  return { path, manifest };
}

test("desktop artifact refuses modified executable bytes before native execution", () => {
  const { path } = fixture();
  writeFileSync(join(path, desktopFile()), "tampered");
  expect(() => verifyDesktopArtifact(path)).toThrow("integrity mismatch");
});
test("desktop artifact refuses traversal and unverified auxiliary data", () => {
  const { path, manifest } = fixture();
  manifest.files["../private"] = { sha256: "0".repeat(64), bytes: 0 };
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
  expect(() => verifyDesktopArtifact(path)).toThrow("unsafe file entry");
  delete manifest.files["../private"];
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(path, "unverified-private-data"), "must not install");
  expect(() => verifyDesktopArtifact(path)).toThrow("Unverified desktop artifact entry");
});
test("desktop artifact refuses executable symlinks and incompatible targets", () => {
  const { path, manifest } = fixture();
  const target = join(path, "linked");
  writeFileSync(target, readFileSync(join(path, desktopFile())));
  rmSync(join(path, desktopFile()));
  symlinkSync(target, join(path, desktopFile()));
  expect(() => verifyDesktopArtifact(path)).toThrow("regular desktop file");
  manifest.target = "unsupported";
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
  expect(() => verifyDesktopArtifact(path)).toThrow("incompatible");
});
test("host metadata refuses an absent native binary", () => {
  expect(() => inspectDesktopBinary("/__missing_native_desktop_binary__")).toThrow();
});

const executable = process.env["YOLO_DESKTOP_TEST_BIN"];
describe.skipIf(executable === undefined)("actual desktop artifact installation", () => {
  test("real host metadata, copied artifact and idempotent verified activation agree", () => {
    const artifact = temp();
    const manifest = writeDesktopManifest(artifact, executable!, true);
    expect(verifyDesktopArtifact(artifact).build).toEqual(manifest.build);
    const home = temp();
    const version = installDesktopArtifact(artifact, home);
    expect(installDesktopArtifact(artifact, home)).toBe(version);
    expect(verifyDesktopArtifact(join(home, version)).files).toEqual(manifest.files);
  }, 30_000);
});
