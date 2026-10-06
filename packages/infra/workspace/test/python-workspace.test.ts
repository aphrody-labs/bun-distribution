// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pythonWorkspaceCommands, runPythonWorkspace, supervise } from "../src/python-workspace.ts";

const fixture = join(import.meta.dir, "fixtures/python-workspace.ts");
const root = "/";
const silent = { diagnostics: () => {} };
const measure = (command: string[], cwd: string = root, options = {}) =>
  supervise(command, cwd, options);

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

test("measurement preserves failure and resource evidence", async () => {
  const result = await measure([process.execPath, fixture, "7"], root, silent);
  expect(result.exitCode).toBe(7);
  expect(result.success).toBe(false);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(result).toHaveProperty("resourceUsage");
  expect(() => JSON.stringify(result)).not.toThrow();
});

test("missing executable is a structured failure", async () => {
  const result = await measure(["/nonexistent/aphrody-workspace-command"], root, silent);
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(127);
});

test("child output cannot contaminate JSON stdout", async () => {
  const child = Bun.spawn([process.execPath, fixture, "measure"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(JSON.parse(stdout).success).toBe(true);
  expect(stderr).toContain("fixture stdout");
  expect(stderr).toContain("fixture stderr");
});

test("plan works and unknown commands fail", async () => {
  const original = console.log;
  try {
    for (const action of [
      "plan",
      "constructor",
      "lint extra",
      "lint --timeout-ms 0",
      "lint --timeout-ms NaN",
    ]) {
      let printed = "";
      console.log = (line: string) => {
        printed += line;
      };
      const code = await runPythonWorkspace(action.split(" "), { root: "/py" });
      const result = JSON.parse(printed);
      expect(code).toBe(action === "plan" ? 0 : 2);
      expect(result.success).toBe(action === "plan");
      if (action === "plan") expect(result.root).toBe("/py");
    }
  } finally {
    console.log = original;
  }
});

test("all Python ecosystem entry points use uv and a lock", () => {
  for (const [action, command] of Object.entries(pythonWorkspaceCommands())) {
    if (action === "build") continue; // `uv build` has no lock flag; the wheel build runs on the build host
    expect(command.slice(0, 3)).toEqual(["uv", "run", "--locked"]);
  }
  for (const command of Object.values(pythonWorkspaceCommands("/vu/bin/uv"))) {
    expect(command[0]).toBe("/vu/bin/uv");
  }
});

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
