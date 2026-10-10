// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostRepositoryRoot, hostRoot } from "../src/host/index.ts";
import { hostPlan } from "../src/host/plan.ts";

test("migrated host plans resolve repository assets above tools/config", () => {
  const root = hostRepositoryRoot();
  expect(hostRoot()).toBe(join(root, "tools/config/host"));
  const plan = hostPlan(["aphrody-mcp-http-dbfr"], { target: "dbfr" });
  const commands = plan.steps.map((step) => step.run).join("\n");
  expect(commands).not.toContain(join(root, "tools/scripts"));
  expect(commands).not.toContain(join(root, "tools/ai.json"));
  expect(plan.steps.some((step) => step.id.endsWith("/tools-count"))).toBe(true);
});

test("legacy host directory overrides keep their existing repository root", () => {
  const root = join(tmpdir(), "legacy-aphrody-layout");
  expect(hostRepositoryRoot(join(root, "config/host"))).toBe(root);
});

test("a linked legacy worktree named tools is not mistaken for the new config owner", () => {
  const directory = mkdtempSync(join(tmpdir(), "host-layout-"));
  try {
    const root = join(directory, "tools");
    mkdirSync(root);
    writeFileSync(join(root, ".git"), "gitdir: /private/worktree\n");
    expect(hostRepositoryRoot(join(root, "config/host"))).toBe(root);
    expect(hostRepositoryRoot(join(root, "tools/config/host"))).toBe(root);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
