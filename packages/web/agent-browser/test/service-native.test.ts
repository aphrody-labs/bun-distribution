// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, spyOn, test } from "bun:test";
import { Runtime, type ManagedProcess } from "@aphrody/runtime-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebService, WebServiceError } from "../src/service.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-web-native-"));
  directories.push(directory);
  const binary = join(directory, "aphrody-web");
  await writeFile(binary, `#!/usr/bin/env bun\n${body}\n`, { mode: 0o700 });
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

test("native acquisition preserves a large binary burst and existing CLI permissions", async () => {
  const binary = await fixture(`
const args = process.argv.slice(2);
if (args[0] !== "--proxy" || args[1] !== "http://fixture:1" || args[2] !== "fetch"
  || args[args.indexOf("--dump") + 1] !== "original"
  || args[args.indexOf("--user-agent") + 1] !== "Fixture/2"
  || !args.includes("--fail-on-http-error")
  || process.env.OBSCURA_ALLOW_PRIVATE_NETWORK !== "1") process.exit(9);
await Promise.all([
  Bun.write(Bun.stdout, new Uint8Array(300000).fill(255)),
  Bun.write(Bun.stderr, new Uint8Array(200000).fill(120)),
]);
`);
  const output = await new WebService({ binary }).bytes("https://example.test/image", {
    proxy: "http://fixture:1",
    userAgent: "Fixture/2",
    allowPrivateNetwork: true,
  });
  expect(output).toEqual(new Uint8Array(300000).fill(255));
});

test("native acquisition preserves exit status and bounded stderr diagnostics", async () => {
  const binary = await fixture(`
await Bun.write(Bun.stderr, "x".repeat(9000) + "\\nfixture failed");
process.exit(9);
`);
  const service = new WebService({ binary });
  try {
    await service.version();
    throw new Error("failure must reject");
  } catch (error) {
    expect(error).toBeInstanceOf(WebServiceError);
    expect(error).toMatchObject({ exitCode: 9, stderr: "x".repeat(1985) + "\nfixture failed" });
    expect((error as Error).message).toContain("exited with 9: fixture failed");
  }
});

test("an externally killed command is a signal exit rather than a timeout", async () => {
  if (process.platform === "win32") return;
  const binary = await fixture('process.kill(process.pid, "SIGKILL");');
  const service = new WebService({ binary });
  await expect(service.version()).rejects.toMatchObject({ exitCode: 137 });
  await expect(service.version()).rejects.toThrow(/exited with 137/);
});

test("output overflow rejects explicitly and releases the native child", async () => {
  const binary = await fixture(`
console.error("budget diagnostics");
await Bun.sleep(25);
await Bun.write(Bun.stdout, new Uint8Array(10000));
setInterval(() => {}, 1000);
`);
  const spawned = spyOn(Runtime.prototype, "spawn");
  try {
    await expect(
      new WebService({ binary, maxOutputBytes: 1024 }).bytes("https://example.test/"),
    ).rejects.toMatchObject({ exitCode: null, stderr: "budget diagnostics\n" });
    const child = spawned.mock.results[0]!.value as ManagedProcess;
    expect(alive(child.pid)).toBe(false);
    expect(() => child.status()).toThrow(/released/);
    await expect(new WebService({ binary, maxOutputBytes: 1024 }).version()).rejects.toThrow(
      /exceeded its 1024 byte output budget/,
    );
  } finally {
    spawned.mockRestore();
  }
});

test("abort preserves the exact caller reason after stopping and releasing the child", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-web-native-abort-"));
  directories.push(directory);
  const ready = join(directory, "ready");
  const binary = await fixture(`
await Bun.write(${JSON.stringify(ready)}, "ready");
setInterval(() => {}, 1000);
`);
  const controller = new AbortController();
  const reason = new Error("caller cancelled native crawl");
  const spawned = spyOn(Runtime.prototype, "spawn");
  const pending = new WebService({ binary })
    .crawl(["https://example.test/"], { signal: controller.signal })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  try {
    const deadline = Date.now() + 2000;
    // Readiness must be observed sequentially before aborting this owned fixture.
    /* eslint-disable no-await-in-loop */
    while (!(await Bun.file(ready).exists()) && Date.now() < deadline) await Bun.sleep(5);
    /* eslint-enable no-await-in-loop */
    expect(await Bun.file(ready).exists()).toBe(true);
    controller.abort(reason);
    expect(await pending).toBe(reason);
    const child = spawned.mock.results[0]!.value as ManagedProcess;
    expect(alive(child.pid)).toBe(false);
    expect(() => child.status()).toThrow(/released/);
  } finally {
    controller.abort(reason);
    await pending;
    spawned.mockRestore();
  }
});

test("an already aborted crawl starts no native process", async () => {
  const spawned = spyOn(Runtime.prototype, "spawn");
  const reason = new Error("preflight cancelled");
  try {
    await expect(
      new WebService({ binary: "/not-used" }).crawl(["https://example.test/"], {
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(spawned).not.toHaveBeenCalled();
  } finally {
    spawned.mockRestore();
  }
});

test("concurrent one-shot commands preserve the shared engine and supervisor", async () => {
  const binary = await fixture('await Bun.sleep(20); console.log("fixture version");');
  const service = new WebService({ binary });
  expect(await Promise.all([service.version(), service.version()])).toEqual([
    "fixture version",
    "fixture version",
  ]);
  // The preload engine belongs to the same SDK owner and remains available.
  const { endpoint } = await service.engine();
  expect(endpoint).toBe(process.env.APHRODY_BROWSER_CDP_URL!);
  await service.close();
  expect(await service.version()).toBe("fixture version");
});

test("native timeout preserves WebServiceError and reaps its owning child", async () => {
  const binary = await fixture(
    'console.error("timeout diagnostics"); setInterval(() => {}, 1000);',
  );
  const spawned = spyOn(Runtime.prototype, "spawn");
  try {
    await expect(
      new WebService({ binary }).fetch("https://example.test/", { timeoutSecs: 0 }),
    ).rejects.toMatchObject({
      exitCode: null,
      stderr: "timeout diagnostics\n",
      message: "aphrody-web fetch timed out after 15000 ms",
    });
    const child = spawned.mock.results[0]!.value as ManagedProcess;
    expect(alive(child.pid)).toBe(false);
    expect(() => child.status()).toThrow(/released/);
  } finally {
    spawned.mockRestore();
  }
}, 20000);

test("invalid output budgets are refused before runtime loading", () => {
  for (const maxOutputBytes of [0, -1, 1.5, NaN, 64 * 1024 * 1024 + 1]) {
    expect(() => new WebService({ maxOutputBytes })).toThrow(RangeError);
  }
});
