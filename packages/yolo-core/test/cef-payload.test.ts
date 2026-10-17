import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyDesktopArtifact } from "@aphrody/runtime-sdk/desktop-artifact";
import { hostTarget } from "@aphrody/runtime-sdk/target";
import { packageDesktop } from "../src/distribution/desktop-package.ts";
import { cefNotice, cefPayload, strippedInArtifact } from "../src/distribution/cef-payload.ts";

const LINUX = "x86_64-unknown-linux-gnu";
const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true });
});
const temp = (): string => {
  const path = mkdtempSync(join(tmpdir(), "cef-payload-"));
  owned.push(path);
  return path;
};
/** A directory shaped like the Linux CEF distribution, with tiny stand-in files. */
function distribution(skip: string[] = []): string {
  const dir = temp();
  mkdirSync(join(dir, "locales"));
  for (const name of [
    "libcef.so",
    "icudtl.dat",
    "v8_context_snapshot.bin",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "resources.pak",
    "libEGL.so",
    "libGLESv2.so",
    "libvk_swiftshader.so",
    "vk_swiftshader_icd.json",
    "libvulkan.so.1",
    "chrome-sandbox",
    "CREDITS.html",
    "locales/en-US.pak",
    "locales/en-US_FEMININE.pak",
    "locales/en-US_MASCULINE.pak",
    "locales/en-US_NEUTER.pak",
    "locales/fr.pak",
  ]) {
    if (!skip.includes(name)) writeFileSync(join(dir, name), `stand-in ${name}`);
  }
  return dir;
}

test("the Linux payload is the bundler list plus the en-US and the present French locale paks, nothing else", () => {
  const dir = distribution();
  const payload = cefPayload(LINUX, dir);
  expect(Object.keys(payload).toSorted()).toEqual(
    [
      "chrome-sandbox",
      "chrome_100_percent.pak",
      "chrome_200_percent.pak",
      "icudtl.dat",
      "libEGL.so",
      "libGLESv2.so",
      "libcef.so",
      "libvk_swiftshader.so",
      "libvulkan.so.1",
      "locales/en-US.pak",
      "locales/en-US_FEMININE.pak",
      "locales/en-US_MASCULINE.pak",
      "locales/en-US_NEUTER.pak",
      "locales/fr.pak",
      "resources.pak",
      "v8_context_snapshot.bin",
      "vk_swiftshader_icd.json",
    ].toSorted(),
  );
  expect(payload["locales/fr.pak"]).toBe(join(dir, "locales", "fr.pak"));
  // The other French variants are optional: absent in the distribution, absent in the payload.
  expect(payload["locales/fr_FEMININE.pak"]).toBeUndefined();
  expect(payload["libcef.so"]).toBe(join(dir, "libcef.so"));
});

test("a missing distribution file is named, and macOS has no payload", () => {
  expect(() => cefPayload(LINUX, distribution(["libcef.so", "locales/en-US.pak"]))).toThrow(
    /libcef\.so, locales\/en-US\.pak/,
  );
  expect(() => cefPayload("aarch64-apple-darwin", distribution())).toThrow("macOS");
  expect(Object.keys(cefPayload("x86_64-pc-windows-msvc", windowsDistribution()))).toContain("libcef.dll");
});

function windowsDistribution(): string {
  const dir = temp();
  mkdirSync(join(dir, "locales"));
  for (const name of [
    "libcef.dll",
    "chrome_elf.dll",
    "icudtl.dat",
    "v8_context_snapshot.bin",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "resources.pak",
    "d3dcompiler_47.dll",
    "dxil.dll",
    "dxcompiler.dll",
    "libEGL.dll",
    "libGLESv2.dll",
    "vk_swiftshader.dll",
    "vk_swiftshader_icd.json",
    "vulkan-1.dll",
    "bootstrap.exe",
    "bootstrapc.exe",
    "locales/en-US.pak",
    "locales/en-US_FEMININE.pak",
    "locales/en-US_MASCULINE.pak",
    "locales/en-US_NEUTER.pak",
  ]) {
    writeFileSync(join(dir, name), name);
  }
  return dir;
}

test("only Linux shared libraries are stripped", () => {
  expect(strippedInArtifact(LINUX, "libcef.so")).toBe(true);
  expect(strippedInArtifact(LINUX, "libvulkan.so.1")).toBe(false);
  expect(strippedInArtifact(LINUX, "resources.pak")).toBe(false);
  expect(strippedInArtifact("x86_64-pc-windows-msvc", "libcef.dll")).toBe(false);
});

test("the Chromium credits become a notice, and their absence is an error", () => {
  const dir = distribution();
  expect(cefNotice(dir)).toEqual({
    "LICENSE-chromium-credits.html": join(dir, "CREDITS.html"),
  });
  expect(() => cefNotice(distribution(["CREDITS.html"]))).toThrow("CREDITS.html");
});

test.skipIf(process.platform !== "linux" || hostTarget() !== LINUX)(
  "packageDesktop ships the executable, the CEF payload and the notices as a verified artifact",
  () => {
    const root = temp();
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.test", ...args], {
        windowsHide: true,
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
    git("init", "-q");
    for (const [name, text] of [
      ["THIRD-PARTY.md", "third party"],
      ["crates/tauri/aphrody-tauri/LICENSE-APACHE-2.0", "apache"],
      ["crates/tauri/aphrody-tauri/LICENSE-MIT", "mit"],
    ] as const) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "fixture");
    const revision = new TextDecoder().decode(git("rev-parse", "HEAD").stdout).trim();
    const dir = distribution();
    const executable = join(dir, "aphrody-app");
    writeFileSync(
      executable,
      `#!/bin/sh\necho '${JSON.stringify({
        name: "yolo-desktop",
        version: "1.2.3",
        protocol: "yolo.desktop/1",
        target: LINUX,
        git_rev: revision,
        rustc: "rustc fixture",
        panic_recovery: true,
        engine: "cef",
      })}'\n`,
    );
    chmodSync(executable, 0o755);
    const output = join(temp(), "artifact");
    packageDesktop({ root, executable, output, strip: false });
    const manifest = verifyDesktopArtifact(output);
    expect(manifest.build.engine).toBe("cef");
    const names = Object.keys(manifest.files);
    expect(names).toContain("yolo-desktop");
    expect(names).toContain("libcef.so");
    expect(names).toContain("locales/en-US.pak");
    expect(names).toContain("LICENSE-chromium-credits.html");
    expect(names).toContain("THIRD-PARTY.md");
    expect(names).toContain("locales/fr.pak");
  },
);
