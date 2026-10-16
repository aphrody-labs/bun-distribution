// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-session-start-"));
  roots.push(root);
  return root;
}

async function context(root: string): Promise<string> {
  const result = Bun.spawn([process.execPath, join(import.meta.dir, "session-start.ts")], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const output = await new Response(result.stdout).text();
  expect(await result.exited).toBe(0);
  const response = JSON.parse(output);
  expect(response.hookSpecificOutput.hookEventName).toBe("SessionStart");
  return response.hookSpecificOutput.additionalContext;
}

test("session startup uses canonical guidance and preserves the current request scope", async () => {
  const root = await fixture();
  await writeFile(join(root, "START-HERE.md"), "Canonical fixture guidance");
  await writeFile(join(root, "agy.md"), "Obsolete backlog fixture");
  const output = await context(root);
  expect(output).toContain("Canonical fixture guidance");
  expect(output).toContain("Backlog entries are context, not new requests.");
  expect(output).not.toContain("Obsolete backlog fixture");
  expect(output).not.toContain("SSH:");
  expect(output).toContain("Git status unavailable");
  expect(output).not.toContain("Clean tree.");
});

test("a checkout without START-HERE receives the canonical file checklist", async () => {
  expect(await context(await fixture())).toContain("AGENTS.md, GOAL.md, PLAN.md and MEMORY.md");
});

test("session startup reports real local changes", async () => {
  const root = await fixture();
  const initialized = Bun.spawnSync(["git", "init", "--quiet"], { cwd: root, windowsHide: true });
  expect(initialized.exitCode).toBe(0);
  await writeFile(join(root, "work-in-progress.txt"), "Concurrent work");
  expect(await context(root)).toContain("?? work-in-progress.txt");
});
