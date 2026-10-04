// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { executeCommand } from "../src/execution.ts";

const native = test.skipIf(
  process.platform !== "linux" ||
    process.arch !== "x64" ||
    !existsSync(join(homedir(), ".yolo/runtime/x86_64-unknown-linux-gnu/current")),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "shenron-native-execution-"));
  temporary.push(path);
  return path;
}
async function waitForFile(path: string) {
  const deadline = Date.now() + 3_000;
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (existsSync(path)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error("Native fixture did not start"));
      }
    }, 5);
  });
  return Number(await readFile(path, "utf8"));
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

test("dry-run and injected runners keep their existing public contracts", async () => {
  const dry = await executeCommand(["not-an-installed-program"], {
    cwd: process.cwd(),
    dryRun: true,
  });
  expect(dry).toMatchObject({ code: 0, status: "planned", stdout: "", stderr: "" });
  const controller = new AbortController();
  const result = await executeCommand(["fixture"], {
    cwd: "/fixture-cwd",
    signal: controller.signal,
    timeoutMs: 100,
    maxOutputBytes: 2_000,
    runner: async (command, cwd, controls) => {
      expect(command).toEqual(["fixture"]);
      expect(cwd).toBe("/fixture-cwd");
      expect(controls).toEqual({
        signal: controller.signal,
        timeoutMs: 100,
        maxOutputBytes: 2_000,
      });
      return { code: 0, stdout: "fixture result", stderr: "diagnostic" };
    },
  });
  expect(result).toEqual({
    command: ["fixture"],
    status: "executed",
    code: 0,
    stdout: "fixture result",
    stderr: "diagnostic",
  });
});

test("already-aborted execution never invokes its runner", async () => {
  const controller = new AbortController();
  controller.abort(new Error("fixture pre-abort"));
  let called = false;
  await expect(
    executeCommand(["fixture"], {
      cwd: process.cwd(),
      signal: controller.signal,
      runner: async () => {
        called = true;
        return { code: 0, stdout: "", stderr: "" };
      },
    }),
  ).rejects.toThrow("fixture pre-abort");
  expect(called).toBe(false);
});

native("native capture preserves more than 64 KiB in both streams and caller cwd", async () => {
  const cwd = await directory();
  const script =
    "process.stdout.write(JSON.stringify({cwd:process.cwd()})+'\\n'+'é'.repeat(100000));process.stderr.write('diagnostic'.repeat(15000));";
  const result = await executeCommand([process.execPath, "-e", script], { cwd, timeoutMs: 5_000 });
  expect(result.code).toBe(0);
  expect(result.status).toBe("executed");
  const newline = result.stdout.indexOf("\n");
  expect(JSON.parse(result.stdout.slice(0, newline)).cwd).toBe(cwd);
  expect(result.stdout.slice(newline + 1)).toBe("é".repeat(100_000));
  expect(result.stderr).toBe("diagnostic".repeat(15_000));
});

native("native execution preserves process failures and stderr diagnostics", async () => {
  await expect(
    executeCommand(
      [process.execPath, "-e", "process.stderr.write('native failure');process.exit(7)"],
      {
        cwd: process.cwd(),
        timeoutMs: 5_000,
      },
    ),
  ).rejects.toThrow(/Commande échouée \(7\)[\s\S]*native failure/);
});

native(
  "timeout joins the owned process before rejecting and the next command recovers",
  async () => {
    const cwd = await directory();
    const marker = join(cwd, "pid");
    const script =
      "await Bun.write(" +
      JSON.stringify(marker) +
      ", String(process.pid));setInterval(()=>{},1000)";
    await expect(
      executeCommand([process.execPath, "-e", script], { cwd, timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
    const pid = await waitForFile(marker);
    expect(alive(pid)).toBe(false);
    const recovered = await executeCommand(
      [process.execPath, "-e", "process.stdout.write('recovered')"],
      { cwd, timeoutMs: 5_000 },
    );
    expect(recovered.stdout).toBe("recovered");
  },
);

native("abort joins the native child before rejecting", async () => {
  const cwd = await directory();
  const marker = join(cwd, "pid");
  const controller = new AbortController();
  const script =
    "await Bun.write(" + JSON.stringify(marker) + ", String(process.pid));setInterval(()=>{},1000)";
  const running = executeCommand([process.execPath, "-e", script], {
    cwd,
    signal: controller.signal,
    timeoutMs: 5_000,
  });
  const pid = await waitForFile(marker);
  controller.abort(new Error("fixture active abort"));
  await expect(running).rejects.toThrow("fixture active abort");
  expect(alive(pid)).toBe(false);
});

native("overflow refuses truncation and cleans up the owned child", async () => {
  const cwd = await directory();
  const marker = join(cwd, "pid");
  const script =
    "await Bun.write(" +
    JSON.stringify(marker) +
    ",String(process.pid));process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)";
  await expect(
    executeCommand([process.execPath, "-e", script], {
      cwd,
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    }),
  ).rejects.toThrow(/OutputLimit/);
  const pid = await waitForFile(marker);
  expect(alive(pid)).toBe(false);
});

native("native signal termination preserves shell-compatible exit status", async () => {
  await expect(
    executeCommand([process.execPath, "-e", "process.kill(process.pid,'SIGTERM')"], {
      cwd: process.cwd(),
      timeoutMs: 5_000,
    }),
  ).rejects.toThrow(/Commande échouée \(143\)/);
});

native("the native supervisor respects command arguments and inherited environment", async () => {
  const cwd = await directory();
  const childDirectory = join(cwd, "nested");
  await mkdir(childDirectory);
  const before = process.env.SHENRON_NATIVE_EXECUTION_FIXTURE;
  process.env.SHENRON_NATIVE_EXECUTION_FIXTURE = "owned-fixture";
  try {
    const result = await executeCommand(
      [
        process.execPath,
        "-e",
        "process.stdout.write(JSON.stringify({args:process.argv.slice(1),marker:process.env.SHENRON_NATIVE_EXECUTION_FIXTURE}))",
        "one argument",
        "two",
      ],
      { cwd: childDirectory, timeoutMs: 5_000 },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["one argument", "two"],
      marker: "owned-fixture",
    });
  } finally {
    if (before === undefined) delete process.env.SHENRON_NATIVE_EXECUTION_FIXTURE;
    else process.env.SHENRON_NATIVE_EXECUTION_FIXTURE = before;
  }
});

test("invalid native deadlines reject before starting a program", async () => {
  await expect(
    executeCommand(["never-start-fixture"], { cwd: process.cwd(), timeoutMs: 0 }),
  ).rejects.toThrow(/positive finite/);
  await expect(
    executeCommand(["never-start-fixture"], { cwd: process.cwd(), timeoutMs: Infinity }),
  ).rejects.toThrow(/positive finite/);
});

native("native command completion joins descendants after their leader exits", async () => {
  const cwd = await directory();
  const marker = join(cwd, "descendant-pid");
  const result = await executeCommand(
    ["/bin/sh", "-c", 'sleep 30 & echo $! > "$1"; exit 0', "owned-fixture", marker],
    { cwd, timeoutMs: 5_000 },
  );
  expect(result.code).toBe(0);
  const pid = await waitForFile(marker);
  expect(alive(pid)).toBe(false);
});
