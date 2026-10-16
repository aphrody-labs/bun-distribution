// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectAutomationInventory } from "../src/automation-inventory.ts";

test("automation inventory discovers the monorepo itself and accepts a worktree git file", async () => {
  const root = await mkdtemp(join(tmpdir(), "infra-automation-"));
  try {
    await writeFile(join(root, ".git"), "gitdir: ../private-git\n");
    await mkdir(join(root, "scripts/audit"), { recursive: true });
    await writeFile(
      join(root, "scripts/audit/check.ts"),
      "throw new Error('must not execute')",
    );
    const report = await collectAutomationInventory(root);
    expect(report.repositories).toHaveLength(1);
    expect(report.scripts).toBe(1);
    expect(report.counts.check).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
