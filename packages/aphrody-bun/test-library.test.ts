// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { add, compileSass, svg } from "./src/index";
import { getAphrodyAbiVersion } from "./src/cli";
import { loadNativeLibrary, nativeLibraryLoaded } from "./src/library";
import { close, loadLib, webExtractTitle, webParseHtml } from "./src/web";

test("all public subpaths can be imported without a native artifact", async () => {
  const child = Bun.spawn({
    windowsHide: true,
    cmd: [
      process.execPath,
      "-e",
      `
      const { nativeLibraryLoaded } = await import("./src/library.ts");
      for (const subpath of ["index", "cli", "web", "svg", "render", "reproduce", "icons", "n2b", "oxc"]) {
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
    env: {
      ...process.env,
      APHRODY_FFI_LIB: join(import.meta.dir, "missing-native-artifact"),
    },
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

let available = false;
try {
  loadNativeLibrary();
  available = true;
} catch (error) {
  if (process.env.APHRODY_FFI_REQUIRE_NATIVE === "1") throw error;
}
const native = test.skipIf(!available);

native("M3, SVG, CLI and Web share one handle and respect close/reload", () => {
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
