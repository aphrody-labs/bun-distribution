// Source: packages/shenron/db/test/constants.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("real bot cockpit re-exports the canonical DB constants without duplication", () => {
  const root = process.env.SHENRON_BOT_ROOT?.trim();
  if (!root) throw new Error("SHENRON_BOT_ROOT must identify the real bot checkout for host-contract qualification.");
  const cockpit = readFileSync(join(root, "src", "api", "ia-cockpit.ts"), "utf8");
  expect(cockpit).toContain('from "@shenron/db/constants"');
  expect(cockpit).not.toMatch(/FEEDBACK_STATUSES\s*=|GOAL_PRIORITIES\s*=/);
});
