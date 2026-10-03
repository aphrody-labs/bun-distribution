// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("standalone dry-run validates the actual environment owner without importing runtime index", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shenron-preflight-"));
  try {
    const source = resolve(import.meta.dir, "../src");
    await mkdir(join(directory, "lib"));
    await writeFile(
      join(directory, "entry-standalone.ts"),
      await readFile(join(source, "entry-standalone.ts")),
    );
    await writeFile(join(directory, "lib/env.ts"), await readFile(join(source, "lib/env.ts")));
    await symlink(resolve(import.meta.dir, "../node_modules"), join(directory, "node_modules"));
    const marker = join(directory, "runtime-was-imported");
    await writeFile(
      join(directory, "index.ts"),
      `await Bun.write(${JSON.stringify(marker)}, "unsafe"); throw new Error("runtime imported");`,
    );
    const token = "fixture-token-never-print";
    const run = async (environment: Record<string, string>) => {
      const child = Bun.spawn(
        [process.execPath, join(directory, "entry-standalone.ts"), "--dry-run"],
        {
          cwd: directory,
          env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...environment },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, exitCode };
    };
    const valid = await run({
      DISCORD_TOKEN_SHENRON: token,
      GUILD_ID: "11111111111111111",
      OWNER_ID: "22222222222222222",
    });
    expect(valid.exitCode, valid.stderr).toBe(0);
    expect(valid.stdout).toContain("Configuration valid");
    expect(valid.stdout + valid.stderr).not.toContain(token);
    expect(await Bun.file(marker).exists()).toBe(false);
    const missing = await run({});
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Invalid environment");
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
