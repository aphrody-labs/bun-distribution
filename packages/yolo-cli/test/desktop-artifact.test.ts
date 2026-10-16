import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopFile,
  desktopTreeDigest,
  inspectDesktopBinary,
  installDesktopArtifact,
  safeDesktopPath,
  verifyDesktopArtifact,
  writeDesktopManifest,
  type DesktopManifest,
} from "@aphrody/runtime-sdk/desktop-artifact";
import { hostTarget } from "@aphrody/runtime-sdk/target";
const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { force: true, recursive: true });
});
const temp = (): string => {
  const path = mkdtempSync(join(tmpdir(), "yolo-desktop-integrity-"));
  owned.push(path);
  return path;
};
const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
function fixture(extra: Record<string, string> = {}): { path: string; manifest: DesktopManifest } {
  const path = temp();
  const bytes = new TextEncoder().encode("not executable; integrity-only hostile-input fixture");
  const revision = "1".repeat(40);
  const manifest: DesktopManifest = {
    schema: "yolo.desktop-artifact/2",
    name: "yolo-desktop",
    protocol: "yolo.desktop/1",
    version: "0.1.0",
    target: hostTarget(),
    executable: desktopFile(),
    files: { [desktopFile()]: { bytes: bytes.length, sha256: sha256(bytes) } },
    source: { revision, dirty: false },
    build: {
      name: "yolo-desktop",
      protocol: "yolo.desktop/1",
      version: "0.1.0",
      target: hostTarget(),
      git_rev: revision,
      rustc: "fixture",
      panic_recovery: true,
      engine: "cef",
    },
  };
  writeFileSync(join(path, desktopFile()), bytes);
  for (const [name, text] of Object.entries(extra)) {
    const data = new TextEncoder().encode(text);
    mkdirSync(join(path, name, ".."), { recursive: true });
    writeFileSync(join(path, name), data);
    manifest.files[name] = { bytes: data.length, sha256: sha256(data) };
  }
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
test("desktop artifact refuses a host that is not CEF and the previous schema", () => {
  const { path, manifest } = fixture();
  (manifest.build as { engine: string }).engine = "system-webview";
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
  expect(() => verifyDesktopArtifact(path)).toThrow("incompatible");
  (manifest.build as { engine: string }).engine = "cef";
  (manifest as { schema: string }).schema = "yolo.desktop-artifact/1";
  writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
  expect(() => verifyDesktopArtifact(path)).toThrow("incompatible");
});
test("host metadata refuses an absent native binary", () => {
  expect(() => inspectDesktopBinary("/__missing_native_desktop_binary__")).toThrow();
});

describe("CEF payload with nested paths", () => {
  test("safe paths are relative, shallow and made of plain segments", () => {
    for (const name of ["libcef.so", "locales/en-US.pak", "a/b/c/d.pak"]) {
      expect(safeDesktopPath(name)).toBe(true);
    }
    for (const name of [
      "manifest.json",
      "../x",
      "/abs",
      "locales/../x",
      "locales//x",
      "a/b/c/d/e.pak",
      ".hidden",
      "dir/.hidden",
      "-flag",
      "with space",
      "back\\slash",
      "",
    ]) {
      expect(safeDesktopPath(name)).toBe(false);
    }
  });
  test("a nested listed file verifies and a nested stray file is refused", () => {
    const { path } = fixture({ "libcef.so": "library", "locales/en-US.pak": "strings" });
    expect(verifyDesktopArtifact(path, false).files["locales/en-US.pak"]?.bytes).toBe(7);
    writeFileSync(join(path, "locales", "fr.pak"), "unlisted");
    expect(() => verifyDesktopArtifact(path, false)).toThrow("Unverified desktop artifact entry");
  });
  test("an unlisted directory and a symlinked directory are refused", () => {
    const { path } = fixture({ "locales/en-US.pak": "strings" });
    mkdirSync(join(path, "empty-dir"));
    expect(() => verifyDesktopArtifact(path, false)).toThrow("Unverified desktop artifact entry");
    rmSync(join(path, "empty-dir"), { recursive: true });
    const outside = temp();
    mkdirSync(join(outside, "locales"));
    writeFileSync(join(outside, "locales", "en-US.pak"), "strings");
    rmSync(join(path, "locales"), { recursive: true });
    symlinkSync(join(outside, "locales"), join(path, "locales"));
    expect(() => verifyDesktopArtifact(path, false)).toThrow();
  });
  test("a modified nested file fails its digest", () => {
    const { path } = fixture({ "locales/en-US.pak": "strings" });
    writeFileSync(join(path, "locales", "en-US.pak"), "STRINGS");
    expect(() => verifyDesktopArtifact(path, false)).toThrow("integrity mismatch");
  });
  test("the tree digest changes with any payload file, not only the executable", () => {
    const first = fixture({ "libcef.so": "one" }).manifest;
    const second = fixture({ "libcef.so": "two" }).manifest;
    expect(first.files[desktopFile()]).toEqual(second.files[desktopFile()]);
    expect(desktopTreeDigest(first)).not.toBe(desktopTreeDigest(second));
  });
});

const executable = process.env["YOLO_DESKTOP_TEST_BIN"];
describe.skipIf(executable === undefined)("actual desktop artifact installation", () => {
  test("real host metadata, copied artifact and idempotent verified activation agree", () => {
    const artifact = temp();
    const payload = temp();
    writeFileSync(join(payload, "libcef.so"), "stand-in for the CEF library");
    chmodSync(join(payload, "libcef.so"), 0o644);
    const manifest = writeDesktopManifest(artifact, executable!, true, {
      payload: { "libcef.so": join(payload, "libcef.so") },
    });
    expect(verifyDesktopArtifact(artifact).build).toEqual(manifest.build);
    const home = temp();
    const version = installDesktopArtifact(artifact, home);
    expect(installDesktopArtifact(artifact, home)).toBe(version);
    expect(verifyDesktopArtifact(join(home, version)).files).toEqual(manifest.files);
  }, 30_000);
});
