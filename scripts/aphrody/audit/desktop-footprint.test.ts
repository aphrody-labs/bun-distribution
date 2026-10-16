// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cpuTicks, processTree, summarize, treePssMiB, treeTicks } from "./desktop-footprint.ts";

test("summarize reports the median and the range, and ignores missing samples", () => {
  expect(summarize([5, 1, 3])).toEqual({ median: 3, min: 1, max: 5 });
  expect(summarize([4, 2, null, 8, 6])).toEqual({ median: 5, min: 2, max: 8 });
  expect(summarize([null, null])).toEqual({ median: null, min: null, max: null });
});

test("the process tree follows parents, CPU and PSS come from /proc", async () => {
  const child = spawn("sh", ["-c", "sleep 30 & wait"], { windowsHide: true, stdio: "ignore" });
  try {
    let tree: number[] = [];
    for (let i = 0; i < 40 && tree.length < 2; i++) {
      await Bun.sleep(50);
      tree = processTree(child.pid!);
    }
    expect(tree[0]).toBe(child.pid!);
    expect(tree.length).toBeGreaterThanOrEqual(2);
    expect(treePssMiB(tree)).toBeGreaterThan(0);
    expect(treeTicks(tree)).toBeGreaterThanOrEqual(0);
    expect(cpuTicks("/proc/0/does-not-exist")).toBe(0);
  } finally {
    for (const pid of processTree(child.pid!).reverse()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* gone */
      }
    }
  }
});
