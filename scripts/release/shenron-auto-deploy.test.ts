// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Integration test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Integration test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shenron-sync-integration-"));
  temporary.push(root);
  const origin = join(root, "origin.git");
  const publisher = join(root, "publisher");
  const source = join(root, "source");
  const state = join(root, "state");
  git(root, "init", "--bare", "--initial-branch=main", origin);
  git(root, "clone", origin, publisher);
  await Bun.write(join(publisher, "content.txt"), "initial\n");
  git(publisher, "add", "content.txt");
  git(publisher, "commit", "-m", "Initial fixture");
  git(publisher, "push", "origin", "main");
  git(root, "clone", origin, source);
  const initial = git(source, "rev-parse", "HEAD");
  const config = join(root, "config.json");
  await Bun.write(config, JSON.stringify({ source, state, bun: process.execPath }));
  return {
    source,
    publisher,
    initial,
    async advance() {
      await Bun.write(join(publisher, "content.txt"), "upstream change\n");
      git(publisher, "commit", "-am", "Advance origin main");
      git(publisher, "push", "origin", "main");
      return git(publisher, "rev-parse", "HEAD");
    },
    async sync() {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "shenron-auto-deploy.ts"), "sync"],
        {
          cwd: root,
          env: { ...process.env, SHENRON_AUTO_DEPLOY_CONFIG: config },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const receipt = await Bun.file(join(state, "sync.json")).json();
      return { code, stdout, stderr, receipt };
    },
  };
}

test("sync fetches local origin/main and fast-forwards the real checkout", async () => {
  const f = await fixture();
  const latest = await f.advance();
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(0);
  expect(git(f.source, "rev-parse", "HEAD")).toBe(latest);
  expect(git(f.source, "rev-parse", "origin/main")).toBe(latest);
  expect(await Bun.file(join(f.source, "content.txt")).text()).toBe("upstream change\n");
  expect(result.receipt).toMatchObject({ status: "synchronized", commit: latest });
});

test("sync preserves tracked and untracked local edits and exits 75", async () => {
  const f = await fixture();
  const latest = await f.advance();
  await Bun.write(join(f.source, "content.txt"), "local work\n");
  await Bun.write(join(f.source, "untracked.txt"), "unique work\n");
  const before = git(f.source, "status", "--porcelain");
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(75);
  expect(result.receipt).toMatchObject({ status: "skipped", reason: "local-changes" });
  expect(git(f.source, "rev-parse", "HEAD")).toBe(f.initial);
  expect(git(f.source, "rev-parse", "origin/main")).toBe(latest);
  expect(git(f.source, "status", "--porcelain")).toBe(before);
  expect(await Bun.file(join(f.source, "content.txt")).text()).toBe("local work\n");
  expect(await Bun.file(join(f.source, "untracked.txt")).text()).toBe("unique work\n");
});

test("sync refuses a different branch and preserves its checkout", async () => {
  const f = await fixture();
  await f.advance();
  git(f.source, "switch", "-c", "feature/local");
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(75);
  expect(result.receipt).toMatchObject({ status: "skipped", reason: "branch-not-main" });
  expect(git(f.source, "branch", "--show-current")).toBe("feature/local");
  expect(git(f.source, "rev-parse", "HEAD")).toBe(f.initial);
  expect(await Bun.file(join(f.source, "content.txt")).text()).toBe("initial\n");
});

test("sync refuses divergent history without discarding the local commit", async () => {
  const f = await fixture();
  const upstream = await f.advance();
  await Bun.write(join(f.source, "local.txt"), "committed local work\n");
  git(f.source, "add", "local.txt");
  git(f.source, "commit", "-m", "Unique local commit");
  const local = git(f.source, "rev-parse", "HEAD");
  const result = await f.sync();
  expect(result.code, result.stderr).toBe(75);
  expect(result.receipt).toMatchObject({ status: "skipped", reason: "divergent-history" });
  expect(git(f.source, "rev-parse", "HEAD")).toBe(local);
  expect(git(f.source, "rev-parse", "origin/main")).toBe(upstream);
  expect(git(f.source, "status", "--porcelain")).toBe("");
  expect(await Bun.file(join(f.source, "local.txt")).text()).toBe("committed local work\n");
});
