import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectSetupSources } from "./setup-submodules.ts";

const fixture = await mkdtemp(join(tmpdir(), "bun-os-setup-sources-"));
const source = join(fixture, "source");
const product = join(fixture, "product");
async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code) throw new Error(`Fixture Git failed: ${stderr}`);
  return stdout.trim();
}
async function commit(cwd: string) {
  await git(cwd, "add", ".");
  await git(
    cwd,
    "-c",
    "user.name=Setup Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  );
}
afterAll(async () => {
  if (!resolve(fixture).startsWith(resolve(tmpdir(), "bun-os-setup-sources-")))
    throw new Error("Unexpected fixture cleanup path");
  await rm(fixture, { recursive: true, force: true });
});

test("setup preflight retains a live source revision and uncommitted work", async () => {
  await git(fixture, "init", source);
  await Bun.write(join(source, "input.txt"), "first\n");
  await commit(source);
  await git(fixture, "init", product);
  await git(product, "-c", "protocol.file.allow=always", "submodule", "add", source, "runtime");
  await commit(product);
  expect((await inspectSetupSources(product)).ready).toBe(true);
  const runtime = join(product, "runtime");
  await Bun.write(join(runtime, "input.txt"), "second\n");
  await commit(runtime);
  await Bun.write(join(runtime, "concurrent.txt"), "preserve\n");
  const head = await git(runtime, "rev-parse", "HEAD");
  const plan = await inspectSetupSources(product);
  expect(plan.ready).toBe(false);
  expect(plan.retained).toHaveLength(1);
  expect(await git(runtime, "rev-parse", "HEAD")).toBe(head);
  expect(await Bun.file(join(runtime, "concurrent.txt")).text()).toBe("preserve\n");
});
