// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFactoryPlan,
  buildFactoryPreparePlan,
  runBuildFactory,
  type BuildFactoryConfig,
} from "../../src/automation/build-factory.ts";
import { factorySourceScope } from "../../src/automation/build-factory-source.ts";
import { factoryJobPlan, factoryJobStatusPlan } from "../../src/automation/build-factory-jobs.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-factory-gitlinks-"));
  roots.push(root);
  const remote = join(root, "parent.git");
  const source = join(root, "source");
  const checkout = join(root, "workspaces/yolo");
  const remoteUrl = "https://github.com/aphrody-labs/yolo.git";
  const env = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `url.file://${remote}.insteadOf`,
    GIT_CONFIG_VALUE_0: remoteUrl,
    GIT_CONFIG_KEY_1: "protocol.file.allow",
    GIT_CONFIG_VALUE_1: "always",
  };
  const git = async (cwd: string, ...args: string[]) => {
    const child = Bun.spawn(["git", ...args], {
      windowsHide: true,
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5000,
    });
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`Fixture Git failed: ${error}`);
    return output.trim();
  };
  const repository = async (name: string) => {
    const local = join(root, name);
    const bare = join(root, `${name}.git`);
    await git(root, "init", "--quiet", "-b", "main", local);
    await git(root, "init", "--bare", "--quiet", "-b", "main", bare);
    await git(local, "config", "user.name", "fixture");
    await git(local, "config", "user.email", "fixture@localhost");
    await writeFile(join(local, "source.txt"), `${name} source\n`);
    await writeFile(join(local, ".gitignore"), "ignored/\n");
    await git(local, "add", ".");
    await git(local, "commit", "--quiet", "-m", "initial");
    await git(local, "remote", "add", "origin", `file://${bare}`);
    await git(local, "push", "--quiet", "origin", "main");
    return { local, bare, revision: await git(local, "rev-parse", "HEAD") };
  };
  const nested = await repository("nested-source");
  const selected = await repository("selected-source");
  const sibling = await repository("sibling-source");
  await git(selected.local, "submodule", "add", "--quiet", `file://${nested.bare}`, "nested");
  await git(selected.local, "commit", "--quiet", "-am", "nested gitlink");
  await git(selected.local, "push", "--quiet", "origin", "main");
  selected.revision = await git(selected.local, "rev-parse", "HEAD");
  await git(root, "init", "--quiet", "-b", "main", source);
  await git(root, "init", "--bare", "--quiet", "-b", "main", remote);
  await git(source, "config", "user.name", "fixture");
  await git(source, "config", "user.email", "fixture@localhost");
  await writeFile(join(source, "owner.txt"), "parent glue\n");
  await git(source, "submodule", "add", "--quiet", `file://${selected.bare}`, "vendor/bun");
  await git(source, "submodule", "add", "--quiet", `file://${sibling.bare}`, "design/m3");
  await git(source, "add", ".");
  await git(source, "commit", "--quiet", "-m", "parent sources");
  await git(source, "remote", "add", "origin", remoteUrl);
  await git(source, "push", "--quiet", "origin", "main");
  const revision = await git(source, "rev-parse", "HEAD");
  const config: BuildFactoryConfig = {
    schemaVersion: 1,
    enabled: true,
    target: "vps",
    rust: { maxJobs: 1 },
    cacheRoot: join(root, "cache"),
    artifactRoot: join(root, "artifacts"),
    lockPath: join(root, "locks/heavy.lock"),
    repositories: { aphrody: join(root, "workspaces/aphrody"), yolo: checkout },
  };
  const pin = {
    path: source,
    remote: "origin",
    url: remoteUrl,
    repositoryName: "yolo", branch: "main",
    owners: ["aphrody-labs"],
  };
  const execute = async (command: string) => {
    const child = Bun.spawn(["bash", "-c", command], {
      windowsHide: true,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10000,
    });
    const [output, error, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { output, error, exitCode };
  };
  await git(root, "clone", "--quiet", remoteUrl, checkout);
  await git(checkout, "submodule", "update", "--init", "--recursive", "--", "vendor/bun");
  const prepare = (parent = revision, paths: readonly string[] | null = ["vendor/bun"]) =>
    execute(
      buildFactoryPreparePlan(config, "yolo", parent, pin, {
        submodules: paths ?? undefined,
      }).transport[5]!,
    );
  const commit = async (message: string) => {
    await git(source, "add", ".");
    await git(source, "commit", "--quiet", "-m", message);
    await git(source, "push", "--quiet", "origin", "main");
    return git(source, "rev-parse", "HEAD");
  };
  return {
    root,
    source,
    checkout,
    selected,
    sibling,
    nested,
    env,
    git,
    revision,
    config,
    pin,
    execute,
    prepare,
    commit,
  };
}

test("selection accepts normalized exact paths and refuses ambiguous or escaping closures", () => {
  expect(factorySourceScope()).toEqual({ kind: "all" });
  expect(factorySourceScope(["vendor/bun", "vendor/bun"])).toEqual({
    kind: "gitlinks",
    paths: ["vendor/bun"],
  });
  for (const paths of [
    [],
    ["../bun"],
    ["/vendor/bun"],
    ["vendor/*"],
    ["vendor/bun/"],
    ["vendor", "vendor/bun"],
    ["vendor/bun,nested"],
  ]) {
    expect(() => factorySourceScope(paths)).toThrow();
  }
});

test.skipIf(process.platform === "win32")(
  "selected verification reads the existing pinned closure and ignores an unreachable sibling",
  async () => {
    const f = await fixture();
    await f.git(f.source, "config", "-f", ".gitmodules", "submodule.design/m3.url", `file://${f.root}/unreachable.git`);
    const revision = await f.commit("unreachable unrelated provider");
    await f.git(f.checkout, "fetch", "origin");
    await f.git(f.checkout, "merge", "--ff-only", revision);
    const result = await f.prepare(revision);
    expect(result.exitCode).toBe(0);
    expect(await f.git(f.checkout, "rev-parse", "HEAD")).toBe(revision);
    expect(await f.git(join(f.checkout, "vendor/bun"), "rev-parse", "HEAD")).toBe(f.selected.revision);
    expect(await f.git(join(f.checkout, "vendor/bun/nested"), "rev-parse", "HEAD")).toBe(f.nested.revision);
    expect(await Bun.file(join(f.checkout, "design/m3/.git")).exists()).toBe(false);
    const receipt = JSON.parse(result.output.split("\n").find(line => line.startsWith('{"sourceScope"'))!);
    expect(receipt.sourceScope).toEqual({
      kind: "gitlinks",
      parentRevision: revision,
      gitlinks: [{ path: "vendor/bun", revision: f.selected.revision }],
      wholeRepositoryQualified: false,
    });
    const defaultPlan = buildFactoryPreparePlan(f.config, "yolo", revision, f.pin);
    expect(defaultPlan.sourceScope).toEqual({ kind: "all" });
    expect(defaultPlan.transport[5]).toContain("git submodule update --init --recursive --jobs 4 --filter=blob:none\n");
  },
);

test.skipIf(process.platform === "win32")(
  "dirty unrelated sources survive selected preparation/build while exhaustive preparation still refuses them",
  async () => {
    const f = await fixture();
    await f.git(f.checkout, "submodule", "update", "--init", "--recursive");
    expect((await f.prepare(f.revision, null)).exitCode).toBe(0);
    const sibling = join(f.checkout, "design/m3");
    await writeFile(join(sibling, "source.txt"), "concurrent unrelated work\n");
    await writeFile(join(sibling, "untracked.txt"), "unrelated untracked work\n");
    expect((await f.prepare()).exitCode).toBe(0);
    const run = buildFactoryPlan(f.config, "yolo", f.revision, ["bash", "-c", "printf qualified"], {
      submodules: ["vendor/bun"],
    });
    const result = await f.execute(run.transport[5]!);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("qualified");
    expect(await readFile(join(sibling, "source.txt"), "utf8")).toBe("concurrent unrelated work\n");
    expect(await readFile(join(sibling, "untracked.txt"), "utf8")).toBe("unrelated untracked work\n");
    expect((await f.prepare(f.revision, null)).exitCode).toBe(2);
  },
);

test.skipIf(process.platform === "win32")(
  "selected dirty roots, descendants, index pins and parent files are refused without overwriting work",
  async () => {
    const f = await fixture();
    expect((await f.prepare()).exitCode).toBe(0);
    const selected = join(f.checkout, "vendor/bun");
    await f.git(f.checkout, "config", "submodule.vendor/bun.ignore", "all");
    await writeFile(join(selected, "source.txt"), "selected concurrent work\n");
    expect((await f.prepare()).exitCode).toBe(2);
    expect(await readFile(join(selected, "source.txt"), "utf8")).toBe("selected concurrent work\n");
    await f.git(selected, "restore", "source.txt");
    await writeFile(join(selected, "nested/source.txt"), "nested concurrent work\n");
    expect((await f.prepare()).exitCode).toBe(2);
    await f.git(join(selected, "nested"), "restore", "source.txt");
    await f.git(f.checkout, "update-index", "--cacheinfo", `160000,${f.nested.revision},vendor/bun`);
    const stagedPinRefusal = await f.prepare();
    expect(stagedPinRefusal.exitCode).toBe(2);
    expect(stagedPinRefusal.error).toContain("gitlink differs from the parent index or pin");
    expect(await f.git(f.checkout, "rev-parse", ":vendor/bun")).toBe(f.nested.revision);
    expect(await f.git(selected, "rev-parse", "HEAD")).toBe(f.selected.revision);
    await f.git(f.checkout, "restore", "--staged", "vendor/bun");
    await writeFile(join(f.checkout, "owner.txt"), "concurrent glue\n");
    expect((await f.prepare()).exitCode).toBe(2);
    expect(await readFile(join(f.checkout, "owner.txt"), "utf8")).toBe("concurrent glue\n");
  },
);

test.skipIf(process.platform === "win32")(
  "selection refuses non-gitlinks and symlink escapes before mutating selected sources",
  async () => {
    const f = await fixture();
    const invalid = await f.prepare(f.revision, ["owner.txt"]);
    expect(invalid.exitCode).toBe(2);
    expect(invalid.error).toContain("not a gitlink");
    expect((await f.prepare()).exitCode).toBe(0);
    const selected = join(f.checkout, "vendor/bun");
    await rm(selected, { recursive: true });
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "preserved.txt"), "outside work\n");
    await symlink(outside, selected);
    const escaped = await f.prepare();
    expect(escaped.exitCode).toBe(2);
    expect(escaped.error).toContain("resolves elsewhere");
    expect(await readFile(join(outside, "preserved.txt"), "utf8")).toBe("outside work\n");
  },
);

test.skipIf(process.platform === "win32")(
  "selected updates preserve ignored collisions at the next pinned revision",
  async () => {
    const f = await fixture();
    expect((await f.prepare()).exitCode).toBe(0);
    await mkdir(join(f.selected.local, "ignored"));
    await writeFile(join(f.selected.local, "ignored/collision.txt"), "new tracked input\n");
    await f.git(f.selected.local, "add", "-f", "ignored/collision.txt");
    await f.git(f.selected.local, "commit", "--quiet", "-m", "tracked ignored path");
    await f.git(f.selected.local, "push", "--quiet", "origin", "main");
    const next = await f.git(f.selected.local, "rev-parse", "HEAD");
    await f.git(join(f.source, "vendor/bun"), "fetch", "origin");
    await f.git(join(f.source, "vendor/bun"), "checkout", "--quiet", "--detach", next);
    const parent = await f.commit("next selected pin");
    await mkdir(join(f.checkout, "vendor/bun/ignored"));
    await writeFile(join(f.checkout, "vendor/bun/ignored/collision.txt"), "protected ignored output\n");
    expect((await f.prepare(parent)).exitCode).not.toBe(0);
    expect(await readFile(join(f.checkout, "vendor/bun/ignored/collision.txt"), "utf8")).toBe(
      "protected ignored output\n",
    );
    expect(await f.git(join(f.checkout, "vendor/bun"), "rev-parse", "HEAD")).toBe(f.selected.revision);
  },
);

test.skipIf(process.platform === "win32")(
  "detached owner requests bind the selected scope to their fingerprint and retain it in status",
  async () => {
    const f = await fixture();
    expect((await f.prepare()).exitCode).toBe(0);
    const selected = buildFactoryPlan(f.config, "yolo", f.revision, ["true"], {
      submodules: ["vendor/bun"],
    });
    const all = buildFactoryPlan(f.config, "yolo", f.revision, ["true"]);
    const job = factoryJobPlan(f.config, selected, "selected-fixture");
    expect(job.fingerprint).not.toBe(factoryJobPlan(f.config, all, "all-fixture").fingerprint);
    expect(() => factoryJobPlan(f.config, { ...selected, sourceScope: { kind: "all" } }, "tampered")).toThrow("intact");
    const submitted = await f.execute(job.transport[5]!);
    expect(submitted.exitCode).toBe(0);
    expect(JSON.parse(submitted.output).sourceScope).toEqual(selected.sourceScope);
    let receipt: any;
    for (let i = 0; i < 100; i++) {
      // oxlint-disable-next-line no-await-in-loop
      const status = await f.execute(factoryJobStatusPlan(f.config, "selected-fixture").transport[5]!);
      receipt = JSON.parse(status.output);
      if (receipt.status === "succeeded" || receipt.status === "failed") break;
      // oxlint-disable-next-line no-await-in-loop
      await Bun.sleep(20);
    }
    expect(receipt.status).toBe("succeeded");
    expect(receipt.sourceScope).toEqual(selected.sourceScope);
  },
);

test("CLI selection rejects an incompatible --no-submodules combination before dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-factory-selection-cli-"));
  roots.push(root);
  expect(await runBuildFactory(["prepare", "--submodules", "../outside"], root)).toBe(2);
  expect(() =>
    buildFactoryPreparePlan(
      { schemaVersion: 1 } as BuildFactoryConfig,
      "yolo",
      "a".repeat(40),
      {
        path: "/source",
        remote: "origin",
        url: "https://github.com/aphrody-labs/yolo.git",
        repositoryName: "yolo", branch: "main",
        owners: ["aphrody-labs"],
      },
      { submodules: ["vendor/bun"], initializeSubmodules: false },
    ),
  ).toThrow("cannot be combined");
});

test.skipIf(process.platform === "win32")(
  "CLI plans pass the same selection to preparation, execution and detached owner receipts without dispatch",
  async () => {
    const f = await fixture();
    const root = join(f.root, "owner-config");
    await mkdir(join(root, "tools", "aphrody", "config"), { recursive: true });
    await writeFile(join(root, "tools/aphrody/config/build-factory.json"), JSON.stringify(f.config));
    await writeFile(
      join(root, "tools/aphrody/config/commit-sync.json"),
      JSON.stringify({
        schemaVersion: 1,
        owners: ["aphrody-labs"],
        repositories: [
          {
            id: "yolo",
            path: f.source,
            remote: "origin",
            sourceBranch: "main",
            destinationBranch: "main",
            fastForward: false,
          },
        ],
        pollIntervalMs: 60000,
        debounceMs: 25,
        commandTimeoutMs: 5000,
      }),
    );
    const logs: string[] = [];
    const log = spyOn(console, "log").mockImplementation(value => {
      logs.push(String(value));
    });
    try {
      const args = ["--repo", "yolo", "--revision", f.revision, "--submodules", "vendor/bun"];
      expect(await runBuildFactory(["prepare", ...args], root)).toBe(0);
      expect(JSON.parse(logs.at(-1)!).sourceScope).toEqual({
        kind: "gitlinks",
        paths: ["vendor/bun"],
      });
      expect(await runBuildFactory(["plan", ...args, "--", "true"], root)).toBe(0);
      expect(JSON.parse(logs.at(-1)!).sourceScope).toEqual({
        kind: "gitlinks",
        paths: ["vendor/bun"],
      });
      expect(await runBuildFactory(["plan", ...args, "--detach", "--job", "selected-cli", "--", "true"], root)).toBe(0);
      const job = JSON.parse(logs.at(-1)!);
      expect(job.sourceScope).toEqual({
        kind: "gitlinks",
        paths: ["vendor/bun"],
      });
      expect(job.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(await f.git(f.checkout, "rev-parse", "HEAD")).toBe(f.revision);
      expect(await f.git(f.checkout, "symbolic-ref", "--short", "HEAD")).toBe("main");
      expect(await runBuildFactory(["prepare", ...args, "--no-submodules"], root)).toBe(2);
      expect(JSON.parse(logs.at(-1)!).error).toContain("cannot be combined");
    } finally {
      log.mockRestore();
    }
  },
);

test.skipIf(process.platform === "win32")(
  "a selected pin mismatch or uninitialized descendant prevents the owner command",
  async () => {
    const f = await fixture();
    expect((await f.prepare()).exitCode).toBe(0);
    const selected = join(f.checkout, "vendor/bun");
    const plan = buildFactoryPlan(f.config, "yolo", f.revision, ["bash", "-c", "printf EXECUTED"], {
      submodules: ["vendor/bun"],
    });
    await f.git(selected, "checkout", "--quiet", "--detach", "HEAD^");
    const wrongPin = await f.execute(plan.transport[5]!);
    expect(wrongPin.exitCode).not.toBe(0);
    expect(wrongPin.output).not.toContain("EXECUTED");
    await f.git(selected, "checkout", "--quiet", "--detach", f.selected.revision);
    await rm(join(selected, "nested"), { recursive: true });
    const absent = await f.execute(plan.transport[5]!);
    expect(absent.exitCode).not.toBe(0);
    expect(absent.output).not.toContain("EXECUTED");
  },
);
