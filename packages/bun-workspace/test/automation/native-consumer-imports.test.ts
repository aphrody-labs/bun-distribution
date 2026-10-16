// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderNativeConsumerImports } from "../../src/automation/bun-native.ts";

test("native qualification loads all modules from the selected consumer despite a host decoy", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-consumer-"));
  try {
    const selected = join(root, "selected # consumer");
    await mkdir(join(selected, "src"), { recursive: true });
    await Promise.all(
      ["index", "oxc", "n2b", "cli", "web"].map(file =>
        writeFile(join(selected, "src", `${file}.ts`), `export const origin = ${JSON.stringify(file)};`),
      ),
    );
    const decoy = join(root, "node_modules/@aphrody/bun");
    await mkdir(decoy, { recursive: true });
    await writeFile(join(decoy, "package.json"), JSON.stringify({ name: "@aphrody/bun", main: "index.ts" }));
    await writeFile(join(decoy, "index.ts"), 'throw new Error("wrong consumer loaded");');
    const script = `${renderNativeConsumerImports(selected)}\nconsole.log([m3, oxc, n2b, cli, web].map(module => module.origin).join(","));`;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      windowsHide: true,
      cwd: root,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString().trim()).toBe("index,oxc,n2b,cli,web");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
