// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pythonWorkspaceCommands,
  runPythonWorkspace,
  supervise,
} from "../src/python-workspace.ts";

const fixture = join(import.meta.dir, "fixtures/python-workspace.ts");
const root = "/";
const silent = { diagnostics: () => {} };
// supervise() refuses non-Linux hosts: the native runtime only terminates a whole process tree through
// Linux process groups (crates/engine/yolo-runtime/src/process.rs kills just the leader elsewhere).
const supervisedTest = test.skipIf(process.platform !== "linux");
const measure = (command: string[], cwd: string = root, options = {}) =>
  supervise(command, cwd, options);

async function pids(directory: string): Promise<number[]> {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- poll loop: the pid file is re-read after each sleep until the deadline
    if (await Bun.file(`${directory}/pids.json`).exists()) {
      // oxlint-disable-next-line no-await-in-loop -- poll loop: the pid file is re-read after each sleep until the deadline
      return await Bun.file(`${directory}/pids.json`).json();
    }
    // oxlint-disable-next-line no-await-in-loop -- poll loop: the pid file is re-read after each sleep until the deadline
    await Bun.sleep(5);
  }
  throw new Error("Fixture did not become ready");
}

async function assertStopped(pid: number) {
  const deadline = performance.now() + 1000;
  while (performance.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- poll loop: process state is re-read after each sleep until the deadline
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      // Orphans are reaped by the host's init; a zombie cannot execute.
      if (state === "Z" || state === "X") return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    // oxlint-disable-next-line no-await-in-loop -- poll loop: process state is re-read after each sleep until the deadline
    await Bun.sleep(5);
  }
  throw new Error(`Fixture process ${pid} still runs`);
}

supervisedTest(
  "measurement preserves failure and resource evidence",
  async () => {
    const result = await measure(
      [process.execPath, fixture, "7"],
      root,
      silent,
    );
    expect(result.exitCode).toBe(7);
    expect(result.success).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result).toHaveProperty("resourceUsage");
    expect(() => JSON.stringify(result)).not.toThrow();
  },
);

supervisedTest("missing executable is a structured failure", async () => {
  const result = await measure(
    ["/nonexistent/aphrody-workspace-command"],
    root,
    silent,
  );
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(127);
});

supervisedTest("child output cannot contaminate JSON stdout", async () => {
  const child = Bun.spawn([process.execPath, fixture, "measure"], {
    windowsHide: true,
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
      // oxlint-disable-next-line no-await-in-loop -- scenarios run one after another on a shared fixture; each run's output is asserted before the next
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
    // oxlint-disable-next-line no-await-in-loop -- budgets are checked one by one so each rejection is asserted in order
    const result = await measure([process.execPath, fixture, "0"], root, {
      ...silent,
      timeoutMs,
    });
    expect(result.exitCode).toBe(2);
  }
});

supervisedTest("lossless output refuses overflow explicitly", async () => {
  const result = await measure([process.execPath, fixture, "flood"], root, {
    ...silent,
    maxOutputBytes: 1024,
  });
  expect(result.success).toBe(false);
  expect(result.reason).toBe("output_limit");
  expect(result.exitCode).toBe(125);
});

for (const action of ["timeout", "cancel", "orphan"] as const) {
  supervisedTest(
    `${action} stops the leader and its SIGTERM-resistant descendant`,
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "aphrody-supervisor-"));
      const controller = new AbortController();
      const operation = measure(
        [
          process.execPath,
          fixture,
          action === "orphan" ? "orphan" : "tree",
          directory,
        ],
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
          action === "timeout"
            ? "timeout"
            : action === "cancel"
              ? "cancelled"
              : "exited",
        );
        expect(result.exitCode).toBe(
          action === "timeout" ? 124 : action === "cancel" ? 130 : 0,
        );
        expect(result.durationMs).toBeLessThan(3000);
        // oxlint-disable-next-line no-await-in-loop -- owned processes are asserted stopped one by one, in spawn order
        for (const pid of ownedPids) await assertStopped(pid);
      } finally {
        controller.abort();
        await operation;
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

supervisedTest(
  "missing verified artifact is an explicit prerequisite failure",
  async () => {
    const child = Bun.spawn([process.execPath, fixture, "measure"], {
      windowsHide: true,
      env: {
        ...process.env,
        YOLO_RUNTIME_HOME: "/nonexistent/aphrody-runtime",
      },
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
  },
);

test.skipIf(process.platform === "linux")(
  "hosts without process-group supervision refuse before loading the runtime",
  async () => {
    const result = await measure(
      [process.execPath, fixture, "0"],
      root,
      silent,
    );
    expect(result.reason).toBe("unsupported_platform");
    expect(result.exitCode).toBe(125);
    expect(result).not.toHaveProperty("pid");
  },
);
