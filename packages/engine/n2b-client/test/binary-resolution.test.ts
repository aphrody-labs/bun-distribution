// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test.skipIf(process.platform === "win32")(
  "development fallback finds the root target after migration to Yolo",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "n2b-layout-"));
    try {
      const source = join(root, "packages/engine/n2b-client/src");
      const build = join(root, "target/debug");
      await Promise.all([mkdir(source, { recursive: true }), mkdir(build, { recursive: true })]);
      await copyFile(join(import.meta.dir, "../src/cli.ts"), join(source, "cli.ts"));
      const binary = join(build, "n2b");
      await writeFile(binary, "#!/bin/sh\nprintf 'n2b 9.8.7\\n'\n");
      await chmod(binary, 0o755);
      const proc = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `const {binaryVersion} = await import(${JSON.stringify(join(source, "cli.ts"))}); console.log(await binaryVersion());`,
        ],
        { env: { ...process.env, PATH: "", N2B_BIN: "" }, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout.trim()).toBe("9.8.7");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
