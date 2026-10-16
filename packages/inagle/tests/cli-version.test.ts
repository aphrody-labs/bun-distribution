import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Inagle CLI reports its package version", async () => {
  const root = resolve(import.meta.dir, "..");
  const metadata = await Bun.file(resolve(root, "package.json")).json();
  const proc = Bun.spawn([process.execPath, resolve(root, "src/cli.ts"), "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(metadata.version);
});
