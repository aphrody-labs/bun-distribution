// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFactoryPlan, type BuildFactoryConfig } from "../src/build-factory.ts";

const config: BuildFactoryConfig = {
  schemaVersion: 1,
  enabled: true,
  target: "vps",
  cacheRoot: "/srv/aphrody-build/cache",
  artifactRoot: "/srv/aphrody-build/artifacts",
  lockPath: "/srv/aphrody-build/locks/heavy.lock",
  repositories: { aphrody: "/srv/aphrody-build/workspaces/aphrody" },
  rust: { maxJobs: 6 },
};
const revision = "a".repeat(40);

test("factory plans use the existing Infra owner and shared serial lock", () => {
  const plan = buildFactoryPlan(config, "aphrody", revision, ["bun", "run", "build"]);
  expect(plan.transport.slice(0, 4)).toEqual(["ssh", "exec", "--host", "vps"]);
  expect(plan.transport[5]).toContain("flock -- '/srv/aphrody-build/locks/heavy.lock'");
  expect(plan.transport[5]).toContain("git rev-parse HEAD");
  expect(plan.transport[5]).toContain("git status --porcelain");
  expect(plan.transport[5]).toContain("BUN_INSTALL_CACHE_DIR=");
  expect(plan.command).toEqual(["bun", "run", "build"]);
});

test("factory requires pinned clean source policy and bounded compiler jobs", () => {
  expect(() => buildFactoryPlan(config, "aphrody", "main", ["bun"])).toThrow("pinned Git");
  expect(() => buildFactoryPlan(config, "unknown", revision, ["bun"])).toThrow("repository");
  expect(() =>
    buildFactoryPlan({ ...config, enabled: false }, "aphrody", revision, ["bun"]),
  ).toThrow("enabled");
  expect(() =>
    buildFactoryPlan({ ...config, rust: { maxJobs: 7 } }, "aphrody", revision, ["bun"]),
  ).toThrow("between");
  expect(() => buildFactoryPlan(config, "aphrody", revision, [])).toThrow("owner command");
});

test("factory quotes owner arguments without expanding shell expressions", () => {
  const plan = buildFactoryPlan(config, "aphrody", revision, ["bun", "name'$(echo hidden)"]);
  expect(plan.command[1]).toBe("name'$(echo hidden)");
  expect(plan.transport[5]).not.toContain("exec env bun name");
  expect(() => buildFactoryPlan(config, "aphrody", revision, ["bun", "\0"])).toThrow("NUL");
});

test("factory preserves literal shell-sensitive arguments and refuses changed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-factory-"));
  try {
    const git = async (...args: string[]) => {
      const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      return output.trim();
    };
    await git("init", "--quiet");
    await writeFile(join(root, "source.txt"), "pinned source");
    await git("add", "source.txt");
    await git(
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@localhost",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    await mkdir(join(root, "locks"));
    await writeFile(join(root, ".git/info/exclude"), "locks/\n");
    const fixtureConfig = {
      ...config,
      repositories: { aphrody: root },
      lockPath: join(root, "locks/heavy.lock"),
    };
    const literal = "name'$(echo should-not-expand)`echo literal`";
    const plan = buildFactoryPlan(fixtureConfig, "aphrody", await git("rev-parse", "HEAD"), [
      "bash",
      "-c",
      'printf "%s" "$1"',
      "--",
      literal,
    ]);
    const run = async () => {
      const child = Bun.spawn(["bash", "-c", plan.transport[5]!], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [output, error, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { output, error, exitCode };
    };
    expect(await run()).toEqual({ output: literal, error: "", exitCode: 0 });
    await writeFile(join(root, "source.txt"), "changed source");
    const refused = await run();
    expect(refused.exitCode).toBe(2);
    expect(refused.error).toContain("source checkout is dirty");
    expect(refused.output).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
