// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");
async function run(args: string[]) {
  const process = Bun.spawn([Bun.which("bun")!, cli, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, code };
}

test("migration CLI reports its actual package version", async () => {
  const result = await run(["--version"]);
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe((await Bun.file(resolve(import.meta.dir, "../package.json")).json()).version);
});

test("invalid target flags fail before inspecting source or creating an app", async () => {
  const result = await run(["missing-source", "--target", "unknown"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("--target requires tauri or vite");
});

test("dry-run JSON inspects external source without activating or creating an owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "m3-cli-contract-"));
  try {
    const source = join(directory, "source");
    const target = join(directory, "output");
    await mkdir(join(source, "app"), { recursive: true });
    await writeFile(join(source, "app/page.tsx"), "export default function Page(){return <h1>Inspect</h1>;}");
    const result = await run([source, target, "--target", "vite", "--dry-run", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).requirements).toEqual([]);
    expect(await Bun.file(join(target, "package.json")).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
