// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, spyOn, test } from "bun:test";
import { Runtime, type ManagedProcess } from "@aphrody/runtime-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEngine, type Engine } from "../src/engine.ts";

const directories: string[] = [];
const engines: Engine[] = [];
async function startFixture(binary: string): Promise<Engine> {
  const engine = await startEngine({ binary, startupTimeoutMs: 2000 });
  engines.push(engine);
  return engine;
}
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-engine-lifecycle-"));
  directories.push(directory);
  const binary = join(directory, "aphrody-web");
  await writeFile(
    binary,
    `#!/usr/bin/env bun
const args = process.argv.slice(2);
const host = args[args.indexOf("--host") + 1];
const port = Number(args[args.indexOf("--port") + 1]);
const server = Bun.serve({ hostname: host, port, fetch: () => new Response("{}") });
console.log(\`ws://\${host}:\${port}/devtools/browser\`);
console.error("fixture diagnostics");
${body}
`,
    { mode: 0o700 },
  );
  return binary;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("natural exit releases the engine and retains its final code and diagnostics", async () => {
  const binary = await fixture("setTimeout(() => process.exit(7), 150);");
  const spawned = spyOn(Runtime.prototype, "spawn");
  try {
    const engine = await startFixture(binary);
    const child = spawned.mock.results[0]!.value as ManagedProcess;
    const released = spyOn(child, "release");
    try {
      expect(await engine.exited).toBe(7);
      expect(alive(engine.pid)).toBe(false);
      expect(released).toHaveBeenCalledTimes(1);
      expect(() => child.status()).toThrow(/invalid process handle/);
      expect(engine.stderrTail()).toContain("fixture diagnostics");
      expect(await engine.stop()).toBe(7);
      expect(await engine.stop()).toBe(7);
      expect(released).toHaveBeenCalledTimes(1);
    } finally {
      released.mockRestore();
    }
  } finally {
    spawned.mockRestore();
  }
});

test("concurrent stop and global cleanup share shutdown and reap the child", async () => {
  const binary = await fixture(
    'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 50));',
  );
  // Global shutdown runs in its own host, preserving the shared CDP test engine.
  const script = `
import { startEngine, stopAllEngines } from ${JSON.stringify(join(import.meta.dir, "../src/engine.ts"))};
const engine = await startEngine({ binary: ${JSON.stringify(binary)}, startupTimeoutMs: 2000 });
const first = engine.stop();
if (engine.stop() !== first) throw new Error("stop promise changed");
await stopAllEngines();
try {
  process.kill(engine.pid, 0);
  throw new Error("engine survived global shutdown");
} catch (error) {
  if (error.code !== "ESRCH") throw error;
}
if (await first !== 0 || await engine.exited !== 0) throw new Error("exit code changed");
if (!engine.stderrTail().includes("fixture diagnostics")) throw new Error("diagnostics lost");
`;
  const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
});

test("a new engine can start after previously owned process handles are released", async () => {
  const binary = await fixture('process.on("SIGTERM", () => process.exit(0));');
  // Repeated sequential lifecycles verify that shutdown does not leave stale handles.
  /* eslint-disable no-await-in-loop */
  for (let index = 0; index < 3; index++) {
    const engine = await startFixture(binary);
    expect(await engine.stop()).toBe(0);
    expect(await engine.exited).toBe(0);
    expect(alive(engine.pid)).toBe(false);
  }
  /* eslint-enable no-await-in-loop */
});

test("startup failure reaps the process and leaves subsequent startup usable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-engine-failed-"));
  directories.push(directory);
  const binary = join(directory, "aphrody-web");
  const pidFile = join(directory, "pid");
  await writeFile(
    binary,
    `#!/usr/bin/env bun
await Bun.write(${JSON.stringify(pidFile)}, String(process.pid));
console.error("invalid endpoint fixture");
console.log("ws://invalid/");
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );
  await expect(startEngine({ binary, startupTimeoutMs: 2000 })).rejects.toThrow(
    "unexpected CDP endpoint",
  );
  expect(alive(Number(await Bun.file(pidFile).text()))).toBe(false);
  const validBinary = await fixture('process.on("SIGTERM", () => process.exit(0));');
  const engine = await startFixture(validBinary);
  expect(await engine.stop()).toBe(0);
});

test("stopping one engine preserves another engine owned by the shared runtime", async () => {
  const binary = await fixture('process.on("SIGTERM", () => process.exit(0));');
  const [first, second] = await Promise.all([startFixture(binary), startFixture(binary)]);
  expect(await first.stop()).toBe(0);
  expect(alive(first.pid)).toBe(false);
  expect(alive(second.pid)).toBe(true);
  expect((await fetch(`${second.httpUrl}/json/version`)).status).toBe(200);
  expect(await second.stop()).toBe(0);
});

test("shutdown escalates to SIGKILL while preserving the signal exit code", async () => {
  const binary = await fixture('process.on("SIGTERM", () => {});');
  const engine = await startEngine({ binary, startupTimeoutMs: 2000, shutdownGraceMs: 25 });
  engines.push(engine);
  expect(await engine.stop()).toBe(137);
  expect(await engine.exited).toBe(137);
  expect(alive(engine.pid)).toBe(false);
  expect(engine.stderrTail()).toContain("fixture diagnostics");
});
