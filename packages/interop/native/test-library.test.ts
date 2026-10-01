// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { add, compileSass, svg } from "./src/index";
import { getAphrodyAbiVersion } from "./src/cli";
import { loadNativeLibrary, nativeLibraryLoaded, resolveNativeLibraryPath } from "./src/library";
import { close, loadLib, webExtractTitle, webParseHtml } from "./src/web";

test("all public subpaths can be imported without a native artifact", async () => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `
      const { nativeLibraryLoaded } = await import("./src/library.ts");
      for (const subpath of ["index", "cli", "web", "shenron", "manga", "svg", "render", "reproduce", "icons", "n2b", "oxc"]) {
        await import("./src/" + subpath + ".ts");
      }
      for (const subpath of ["n2b", "oxc"]) await import("@aphrody/bun/" + subpath);
      if (nativeLibraryLoaded()) throw new Error("import loaded native code");
      const { add } = await import("./src/index.ts");
      try { add(1, 2); throw new Error("call unexpectedly succeeded"); }
      catch (error) {
        if (!error.message.includes("APHRODY_FFI_LIB points to a missing file")) throw error;
      }
      console.log("lazy import verified");
    `,
    ],
    cwd: import.meta.dir,
    env: { ...process.env, APHRODY_FFI_LIB: join(import.meta.dir, "missing-native-artifact") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stdout).toBe("lazy import verified\n");
  expect(stderr).toBe("");
  expect(code).toBe(0);
});

test("M3, SVG, CLI and Web share one handle and respect close/reload", () => {
  close();
  expect(nativeLibraryLoaded()).toBe(false);
  expect(add(10, 20)).toBe(30);
  const handle = loadNativeLibrary();
  expect(getAphrodyAbiVersion()).toBe(1);
  expect(webExtractTitle("<title>Unified native library</title>")).toBe("Unified native library");
  expect(compileSass("$color: red; .test { color: $color; }")).toContain("red");
  expect(
    svg({ op: "sanitize", svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"/>' }),
  ).toBeObject();
  expect(loadLib()).toBe(handle);

  const tree = webParseHtml("<p>Shared resources</p>");
  try {
    expect(() => close()).toThrow("live native resources");
    expect(add(1, 2)).toBe(3);
  } finally {
    tree.close();
  }
  close();
  expect(nativeLibraryLoaded()).toBe(false);
  expect(add(2, 3)).toBe(5);
  expect(loadNativeLibrary()).not.toBe(handle);
  close();
});

async function isolatedLibrary(code: string, extra: Record<string, string | undefined> = {}) {
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", code],
    cwd: import.meta.dir,
    env: { ...process.env, APHRODY_FFI_LIB: undefined, SHENRON_FFI_LIB: undefined, ...extra },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) throw new Error(`Isolated loader failed (${exit}): ${stderr}`);
  return stdout;
}

test("compatibility alias uses the shared override policy and rejects contradictory paths", async () => {
  const stdout = await isolatedLibrary(`
    import { resolveNativeLibraryPath } from "./src/library.ts";
    import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    const root = mkdtempSync(join(tmpdir(), "aphrody-shenron-alias-"));
    try {
      const path = join(root, "artifact"); writeFileSync(path, "path policy fixture");
      process.env.SHENRON_FFI_LIB = path;
      if (resolveNativeLibraryPath() !== path) throw new Error("alias ignored");
      process.env.APHRODY_FFI_LIB = path;
      if (resolveNativeLibraryPath() !== path) throw new Error("equal overrides rejected");
      process.env.APHRODY_FFI_LIB = path + "-other";
      try { resolveNativeLibraryPath(); throw new Error("conflicting overrides accepted"); }
      catch (error) { if (!error.message.includes("select different native libraries")) throw error; }
      delete process.env.APHRODY_FFI_LIB; process.env.SHENRON_FFI_LIB = path + "-missing";
      try { resolveNativeLibraryPath(); throw new Error("missing alias accepted"); }
      catch (error) { if (!error.message.includes("SHENRON_FFI_LIB points to a missing file")) throw error; }
      console.log("alias policy verified");
    } finally { rmSync(root, { recursive: true, force: true }); }
  `);
  expect(stdout).toBe("alias policy verified\n");
});

test("Shenron adapter retries failed loading and shares close/reload with the library owner", async () => {
  const artifact = resolveNativeLibraryPath();
  if (!artifact) throw new Error("Lifecycle test requires a real native artifact");
  const adapter = join(import.meta.dir, "../../shenron/pipeline/src/aphrody/native.ts");
  const stdout = await isolatedLibrary(`
    import { loadNativeLibrary, nativeLibraryLoaded, resolveNativeLibraryPath } from "./src/library.ts";
    import { close } from "./src/engine.ts";
    process.env.SHENRON_FFI_LIB = ${JSON.stringify(artifact + ".missing")};
    const native = await import(${JSON.stringify(adapter)});
    if (nativeLibraryLoaded()) throw new Error("import eagerly loaded native code");
    if (native.isNativeAvailable() || native.aphrodyNative.isAvailable) throw new Error("missing artifact available");
    if (native.runCapturedNative(["--help"]) !== null) throw new Error("missing command fallback changed");
    if ((await native.aphrodyNative.run(["--help"])).kind !== "not_found") throw new Error("missing command classification changed");
    if ((await native.aphrodyNative.ragSearch("x")).length !== 0) throw new Error("missing search fallback changed");
    if ((await native.aphrodyNative.ragStats()) !== null || native.aphrodyNative.authStatus() !== null || (await native.aphrodyNative.personaPrompt()) !== null) throw new Error("missing value fallback changed");
    process.env.SHENRON_FFI_LIB = ${JSON.stringify(artifact)};
    if (native.nativeAbiVersion() !== 1 || !native.aphrodyNative.isAvailable) throw new Error("failed load cached permanently");
    if (!nativeLibraryLoaded()) throw new Error("adapter bypassed shared owner");
    const handle = loadNativeLibrary();
    const captured = native.runCapturedNative(["--help"]);
    if (captured?.code !== 0 || !captured.stdout || typeof captured.stderr !== "string") throw new Error("owned captured result invalid");
    if (loadNativeLibrary() !== handle) throw new Error("adapter opened a second handle");
    process.env.SHENRON_FFI_LIB = ${JSON.stringify(artifact + ".other")};
    if (native.isNativeAvailable()) throw new Error("adapter accepted replacement while owner loaded");
    process.env.SHENRON_FFI_LIB = ${JSON.stringify(artifact)};
    close();
    if (nativeLibraryLoaded()) throw new Error("shared close failed");
    if (!native.aphrodyNative.isAvailable || loadNativeLibrary() === handle) throw new Error("adapter retained closed handle");
    close(); console.log("Shenron shared lifecycle verified");
  `);
  expect(stdout).toBe("Shenron shared lifecycle verified\n");
});
