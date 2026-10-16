// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import manifest from "../package.json";

const root = resolve(import.meta.dir, "..");

test("desktop and showcase scripts use their existing native M3 owners", async () => {
  expect(manifest.scripts.dev).toBe("bun ../m3/bin/m3.ts dev");
  expect(await Bun.file(resolve(root, "../m3/bin/m3.ts")).exists()).toBe(true);
  for (const command of ["dev", "build", "serve", "compile", "package", "deploy", "smoke"] as const) {
    const script = manifest.scripts[`showcase:${command}`];
    const inventory = command === "dev" || command === "build" || command === "compile";
    expect(script).toBe(
      `cd showcase && ${inventory ? "bun scripts/inventory.ts && " : ""}bun ../../m3-bun/bin/m3-bun.ts ${command}${command === "deploy" ? " all" : ""}`,
    );
  }
  expect(await Bun.file(resolve(root, "showcase/../../m3-bun/bin/m3-bun.ts")).exists()).toBe(true);
  expect(manifest.scripts["showcase:typecheck"]).toBe("cd showcase && bun check -p tsconfig.json --noEmit");
  expect(manifest.scripts["showcase:test"]).toBe(
    "cd showcase && bun test ./test && bun test --preload @aphrody/m3-config/test/dom ./test-dom",
  );
});

test("both source CLIs execute help without starting a server or native build", async () => {
  for (const [cwd, script, banner] of [
    [root, "../m3/bin/m3.ts", "m3 dev"],
    [resolve(root, "showcase"), "../../m3-bun/bin/m3-bun.ts", "m3-bun dev"],
  ]) {
    const child = Bun.spawn([process.execPath, script!, "help"], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
      timeout: 10_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(banner!);
  }
});
