// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dashboard build uses the frozen local CLI and refuses an absent dependency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shenron-dashboard-"));
  try {
    await mkdir(join(directory, "scripts"));
    const script = join(directory, "scripts/build-dashboard-css.sh");
    await writeFile(
      script,
      await readFile(join(import.meta.dir, "../scripts/build-dashboard-css.sh")),
    );
    const run = async () => {
      const child = Bun.spawn(["bash", script], {
        cwd: directory,
        env: {
          PATH: process.env.PATH ?? "",
          BUN_BIN: process.execPath,
          HTTP_PROXY: "socks5://fixture.invalid:1080",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, exitCode };
    };
    const missing = await run();
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("frozen @tailwindcss/cli dependency is required");
    await mkdir(join(directory, "node_modules/.bin"), { recursive: true });
    await writeFile(
      join(directory, "node_modules/.bin/tailwindcss"),
      `await Bun.write("cli-args.json", JSON.stringify({ args: process.argv.slice(2), proxy: process.env.HTTP_PROXY }));`,
    );
    expect((await run()).exitCode).toBe(0);
    const result = JSON.parse(await readFile(join(directory, "cli-args.json"), "utf8"));
    expect(result.args).toEqual([
      "--input",
      "src/dashboard/styles.css",
      "--output",
      "src/dashboard/styles.compiled.css",
      "--minify",
    ]);
    expect(result.proxy).toBe("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
