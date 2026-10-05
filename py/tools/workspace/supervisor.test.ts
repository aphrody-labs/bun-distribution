// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measure, root } from "./cli.ts";

const fixture = `${root}tools/workspace/fixture.ts`;
const silent = { diagnostics: () => {} };

async function pids(directory: string): Promise<number[]> {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    if (await Bun.file(`${directory}/pids.json`).exists()) {
      return await Bun.file(`${directory}/pids.json`).json();
    }
    await Bun.sleep(5);
  }
  throw new Error("Fixture did not become ready");
}

async function assertStopped(pid: number) {
  const deadline = performance.now() + 1000;
  while (performance.now() < deadline) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      // Orphans are reaped by the host's init; a zombie cannot execute.
      if (state === "Z" || state === "X") return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await Bun.sleep(5);
  }
  throw new Error(`Fixture process ${pid} still runs`);
}

test("abort before launch cannot execute the command", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await measure([process.execPath, fixture, "0"], root, {
    ...silent,
    signal: controller.signal,
  });
  expect(result.exitCode).toBe(130);
  expect(result.reason).toBe("cancelled");
  expect(result).not.toHaveProperty("pid");
});

test("invalid budgets are rejected without executing", async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 0.5, 2_147_483_648]) {
    const result = await measure([process.execPath, fixture, "0"], root, { ...silent, timeoutMs });
    expect(result.exitCode).toBe(2);
  }
});

test("lossless output refuses overflow explicitly", async () => {
  const result = await measure([process.execPath, fixture, "flood"], root, {
    ...silent,
    maxOutputBytes: 1024,
  });
  expect(result.success).toBe(false);
  expect(result.reason).toBe("output_limit");
  expect(result.exitCode).toBe(125);
});

for (const action of ["timeout", "cancel", "orphan"] as const) {
  test(`${action} stops the leader and its SIGTERM-resistant descendant`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "aphrody-supervisor-"));
    const controller = new AbortController();
    const operation = measure(
      [process.execPath, fixture, action === "orphan" ? "orphan" : "tree", directory],
      root,
      {
        ...silent,
        signal: controller.signal,
        timeoutMs: action === "timeout" ? 500 : 3000,
      },
    );
    try {
      const ownedPids = await pids(directory);
      if (action === "cancel") controller.abort();
      const result = await operation;
      expect(result.reason).toBe(
        action === "timeout" ? "timeout" : action === "cancel" ? "cancelled" : "exited",
      );
      expect(result.exitCode).toBe(action === "timeout" ? 124 : action === "cancel" ? 130 : 0);
      expect(result.durationMs).toBeLessThan(3000);
      for (const pid of ownedPids) await assertStopped(pid);
    } finally {
      controller.abort();
      await operation;
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("missing verified artifact is an explicit prerequisite failure", async () => {
  const child = Bun.spawn([process.execPath, fixture, "measure"], {
    cwd: root,
    env: { ...process.env, YOLO_RUNTIME_HOME: "/nonexistent/aphrody-runtime" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode).toBe(0);
  expect(JSON.parse(output).reason).toBe("runtime_unavailable");
  expect(JSON.parse(output).exitCode).toBe(125);
});
