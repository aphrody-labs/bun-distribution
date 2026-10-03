// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFactoryPlan,
  heavyBuildStatus,
  type BuildFactoryConfig,
} from "../src/build-factory.ts";
import { runInfra } from "../src/runtime.ts";

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

test("execution-only hosts reject plans and never implicitly enable local builds", () => {
  const runtimeOnly = { ...config, executionOnlyTargets: ["vps"] };
  expect(() => buildFactoryPlan(runtimeOnly, "aphrody", revision, ["cargo", "test"])).toThrow(
    "execution-only",
  );
  expect(heavyBuildStatus(runtimeOnly, {}).route).toBe("factory");
  expect(heavyBuildStatus(runtimeOnly, { APHRODY_BUILD_HOST: "vps" }).route).toBe("factory");
  expect(heavyBuildStatus(runtimeOnly, { APHRODY_LOCAL_CARGO: "1" }).route).toBe("local");
  expect(
    heavyBuildStatus(runtimeOnly, { APHRODY_BUILD_HOST: "vps", APHRODY_LOCAL_CARGO: "1" }).route,
  ).toBe("factory");
  expect(heavyBuildStatus(runtimeOnly, {}).reason).toContain("new factory host");
});

test.skipIf(process.platform === "win32")("Infra propagates the factory command timeout per invocation without mutating global environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-infra-env-"));
  const original = process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS;
  try {
    const binary = join(root, "infra-fixture");
    await writeFile(
      binary,
      `#!${process.execPath}\nconsole.log(process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS);\n`,
    );
    await chmod(binary, 0o755);
    const result = await runInfra({
      args: ["ssh", "exec", "--host", "vps", "--cmd", "fixture"],
      env: { APHRODY_INFRA_BIN: binary, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "21600" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("21600");
    expect(process.env.APHRODY_SSH_COMMAND_TIMEOUT_SECS).toBe(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("factory plans use the existing Infra owner and shared serial lock", () => {
  const plan = buildFactoryPlan(config, "aphrody", revision, ["bun", "run", "build"]);
  expect(plan.transport.slice(0, 4)).toEqual(["ssh", "exec", "--host", "vps"]);
  expect(plan.transport[5]).toContain("flock --close -- '/srv/aphrody-build/locks/heavy.lock'");
  expect(plan.commandTimeoutSeconds).toBe(21600);
  expect(plan.transport[5]).toContain("git rev-parse HEAD");
  expect(plan.transport[5]).toContain("git status --porcelain");
  expect(plan.transport[5]).toContain("BUN_INSTALL_CACHE_DIR=");
  expect(plan.transport[5]).toContain("CARGO_NET_GIT_FETCH_WITH_CLI=true");
  expect(plan.transport[5]).toContain("APHRODY_CARGO_LOCK_DIR=/srv/aphrody-build/locks");
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
  expect(() =>
    buildFactoryPlan({ ...config, commandTimeoutSeconds: 86401 }, "aphrody", revision, ["bun"]),
  ).toThrow("commandTimeoutSeconds");
});

test("factory quotes owner arguments without expanding shell expressions", () => {
  const plan = buildFactoryPlan(config, "aphrody", revision, ["bun", "name'$(echo hidden)"]);
  expect(plan.command[1]).toBe("name'$(echo hidden)");
  expect(plan.transport[5]).not.toContain("exec env bun name");
  expect(() => buildFactoryPlan(config, "aphrody", revision, ["bun", "\0"])).toThrow("NUL");
});

test.skipIf(process.platform === "win32")("factory preserves literal shell-sensitive arguments and refuses changed source", async () => {
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

test("heavy build status owns the cargo-serial route decision", () => {
  const route = (
    env: Record<string, string>,
    honour = true,
    value: BuildFactoryConfig | null = config,
  ) => heavyBuildStatus(value, env, honour).route;
  expect(route({})).toBe("factory");
  expect(route({ APHRODY_BUILD_HOST: "vps" })).toBe("local");
  expect(route({ APHRODY_LOCAL_CARGO: "1" })).toBe("local");
  expect(route({ APHRODY_LOCAL_CARGO: "1" }, false)).toBe("factory");
  expect(route({}, true, { ...config, enabled: false })).toBe("local");
  expect(route({}, true, null)).toBe("local");
  expect(heavyBuildStatus(config, {})).toEqual({
    configured: true,
    enabled: true,
    target: "vps",
    host: null,
    localCargo: false,
    route: "factory",
    reason: "heavy work runs on vps",
  });
});

test("cargo-serial asks the build-factory owner for the route", async () => {
  const script = await Bun.file(
    join(import.meta.dir, "../../../../scripts/build/rust/cargo-serial.sh"),
  ).text();
  expect(script).toContain('build-factory.ts" status --route');
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../src/build-factory.ts"), "status", "--route"],
    { env: { ...process.env, APHRODY_BUILD_HOST: "vps" }, stdout: "pipe" },
  );
  // The repository currently reserves VPS for execution, including inside the host.
  expect((await new Response(child.stdout).text()).trim()).toBe("factory");
  expect(await child.exited).toBe(0);
});
