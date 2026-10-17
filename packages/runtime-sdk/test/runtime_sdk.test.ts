import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { defaultLibraryPath, ProcessExitedError, Runtime, RuntimeError, Status } from "../../runtime/src/index";

// The precompiled artifact is produced by `just runtime-build`; Bun tests never start Cargo.
const available = existsSync(defaultLibraryPath());
const suite = available ? describe : describe.skip;

describe("runtime SDK without the artifact", () => {
  it("explains how to obtain the library when it is missing", () => {
    expect(() => Runtime.load({ libraryPath: "/nonexistent/libaphrody_ffi.so" })).toThrow(
      /cargo build --profile runtime/,
    );
  });
});

suite("runtime SDK against the precompiled library", () => {
  it("reports the build identity and negotiated ABI", () => {
    using runtime = Runtime.load();
    expect(runtime.abi.major).toBe(1);
    const info = runtime.buildInfo();
    expect(info.name).toBe("yolo-runtime");
    expect(info.abi).toBe(`${runtime.abi.major}.${runtime.abi.minor}`);
    expect(info.panic_recovery).toBe(true);
    expect(runtime.capabilities()).toEqual(
      expect.arrayContaining(["system.stats", "bench.compute", "process.supervise", "http.probe"]),
    );
  });

  it("calls system.stats", () => {
    using runtime = Runtime.load();
    const stats = runtime.systemStats();
    const expected = { darwin: "macos", win32: "windows" }[process.platform as string] ?? process.platform;
    expect(stats.os).toBe(expected);
    expect(stats.timestamp_ms).toBeGreaterThan(0);
  });

  it("runs a benchmark to completion", () => {
    using runtime = Runtime.load();
    using op = runtime.startBenchmark(1000);
    expect(op.wait(10_000)?.message).toContain("1000");
  });

  it("times out, cancels and reports Cancelled", () => {
    using runtime = Runtime.load();
    using op = runtime.startBenchmark(4_294_967_295);
    expect(op.wait(0)).toBeUndefined();
    op.cancel();
    try {
      op.wait(10_000);
      throw new Error("wait() must throw after cancel");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).status).toBe(Status.Cancelled);
    }
  });

  it("bounds concurrent operations and frees the slot on release", () => {
    using runtime = Runtime.load({ maxOperations: 1 });
    const first = runtime.startBenchmark(4_294_967_295);
    try {
      runtime.startBenchmark(10);
      throw new Error("second operation must be refused");
    } catch (error) {
      expect((error as RuntimeError).status).toBe(Status.Busy);
    }
    first.release();
    using second = runtime.startBenchmark(10);
    expect(second.wait(10_000)).toBeDefined();
  });

  it("invalidates operations and rejects use after close", () => {
    const runtime = Runtime.load();
    const op = runtime.startBenchmark(4_294_967_295);
    runtime.close();
    expect(() => runtime.systemStats()).toThrow(/closed/);
    try {
      op.wait(0);
      throw new Error("operation must be invalid after the runtime is closed");
    } catch (error) {
      expect((error as RuntimeError).status).toBe(Status.InvalidHandle);
    }
    runtime.close(); // idempotent
  });
});

suite("runtime:* modules", () => {
  it("imports runtime:system through the preload plugin", async () => {
    const { system } = await import("runtime:system");
    expect(system.capabilities()).toContain("system.stats");
    expect(system.stats().arch.length).toBeGreaterThan(0);
    expect((await system.bench(1000)).message).toContain("1000");
  });

  it("cancels a native benchmark when the AbortSignal fires", async () => {
    const { system } = await import("runtime:system");
    const controller = new AbortController();
    const running = system.bench(4_294_967_295, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stop")), 20);
    await expect(running).rejects.toThrow("stop");
    // the slot is free again
    expect((await system.bench(10)).message).toContain("10");
  });

  it("rejects an already aborted signal without starting native work", async () => {
    const { system } = await import("runtime:system");
    const signal = AbortSignal.abort(new Error("late"));
    await expect(system.bench(10, { signal })).rejects.toThrow("late");
  });

  it("loads optional provider APIs without activating a native engine", async () => {
    const { desktop } = await import("runtime:desktop");
    const { browser, BrowserRuntime } = await import("runtime:browser");
    expect(typeof desktop.open).toBe("function");
    expect(typeof browser.load).toBe("function");
    expect(typeof BrowserRuntime.load).toBe("function");
  });
});

suite("process supervision (runtime:process)", () => {
  const isUnix = process.platform !== "win32";
  const unix = isUnix ? it : it.skip;

  unix("spawns, reports the exit code and passes the environment", () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sh",
      args: ["-c", "exit $CODE"],
      env: { CODE: "7" },
      stdio: "null",
    });
    for (let i = 0; i < 200 && child.status().running; i++) Bun.sleepSync(10);
    const status = child.status();
    expect(status).toMatchObject({ running: false, exitCode: 7, signal: 0 });
    expect(child.pid).toBe(status.pid);
  });

  unix("adds and removes environment variables", () => {
    process.env["YOLO_SDK_INHERITED"] = "yes";
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sh",
      args: ["-c", 'test -z "$YOLO_SDK_INHERITED" && test "$YOLO_SDK_ADDED" = 1'],
      env: { YOLO_SDK_ADDED: "1", YOLO_SDK_INHERITED: undefined },
      stdio: "null",
    });
    for (let i = 0; i < 200 && child.status().running; i++) Bun.sleepSync(10);
    expect(child.status()).toMatchObject({ running: false, exitCode: 0 });
  });

  unix("stops a process group gracefully and reports the signal", () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sh",
      args: ["-c", "sleep 60 & wait"],
      stdio: "null",
    });
    Bun.sleepSync(100);
    expect(child.status().running).toBe(true);
    const status = child.stop(2000);
    expect(status.running).toBe(false);
    expect(status.signal).toBe(15);
  });

  unix("waitForHttp resolves when a server answers and rejects when the process exits first", async () => {
    using runtime = Runtime.load();
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      using child = runtime.spawn({
        program: "sleep",
        args: ["30"],
        stdio: "null",
      });
      expect(
        await child.waitForHttp({
          port: server.port as number,
          path: "/",
          timeoutMs: 5000,
        }),
      ).toBe(200);
    } finally {
      await server.stop(true);
    }
    using dying = runtime.spawn({
      program: "sh",
      args: ["-c", "exit 1"],
      stdio: "null",
    });
    await expect(dying.waitForHttp({ port: 9, timeoutMs: 5000 })).rejects.toBeInstanceOf(ProcessExitedError);
  });

  unix("waitForHttp honors timeouts and AbortSignal", async () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sleep",
      args: ["30"],
      stdio: "null",
    });
    await expect(child.waitForHttp({ port: 9, timeoutMs: 150 })).rejects.toThrow(/not ready/);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stop")), 30);
    await expect(
      child.waitForHttp({
        port: 9,
        timeoutMs: 5000,
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop");
  });

  unix("captures stdout and stderr and waits for the first stdout line", async () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sh",
      args: ["-c", "echo ws://127.0.0.1:1/devtools/browser; echo boom >&2; sleep 30"],
      stdio: "capture",
    });
    expect(await child.waitForStdoutLine({ timeoutMs: 5000 })).toBe("ws://127.0.0.1:1/devtools/browser");
    expect(child.takeStdout()).toBe("");
    for (let i = 0; i < 100 && !child.stderrTail().includes("boom"); i++) Bun.sleepSync(10);
    expect(child.stderrTail()).toContain("boom");
    expect(child.stderrTail()).toContain("boom"); // peek does not clear
    expect(child.takeStderr()).toContain("boom");
    expect(child.takeStderr()).toBe(""); // draining clears
  });

  unix("lossless output preserves binary bursts beyond the old 64 KiB tail", async () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: process.execPath,
      args: [
        "--eval",
        "await Promise.all([Bun.write(Bun.stdout, new Uint8Array(200000).fill(255)), Bun.write(Bun.stderr, new Uint8Array([0, 254, 128]))]);",
      ],
      stdio: "capture-lossless",
    });
    const chunks: Uint8Array[] = [];
    const output = await child.collectOutput({
      timeoutMs: 5000,
      onStderr: bytes => chunks.push(bytes),
    });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 254, 128]));
    expect(output.status).toMatchObject({
      running: false,
      exitCode: 0,
      signal: 0,
    });
    expect(output.stdout).toEqual(new Uint8Array(200000).fill(255));
    expect(output.stderr).toEqual(new Uint8Array([0, 254, 128]));
    expect(child.outputComplete()).toBe(true);
    // Native buffers were copied and released; another drain cannot invalidate returned bytes.
    expect(child.takeStdoutBytes()).toHaveLength(0);
    expect(output.stdout[199999]).toBe(255);
  });

  unix("lossless budget overflow rejects and stops the process", async () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: process.execPath,
      args: ["--eval", "await Bun.write(Bun.stdout, new Uint8Array(200000)); setInterval(() => {}, 1000);"],
      stdio: "capture-lossless",
      maxOutputBytes: 100000,
    });
    await expect(child.collectOutput()).rejects.toMatchObject({
      status: Status.OutputLimit,
    });
    expect(child.status().running).toBe(false);
    expect(child.outputComplete()).toBe(true);
  });

  unix("collectOutput stops the owned process on timeout and abort", async () => {
    using runtime = Runtime.load();
    using timed = runtime.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "capture-lossless",
    });
    await expect(timed.collectOutput({ timeoutMs: 30 })).rejects.toMatchObject({
      status: Status.Timeout,
    });
    expect(timed.status().running).toBe(false);
    using aborted = runtime.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "capture-lossless",
    });
    const controller = new AbortController();
    const reason = new Error("caller stopped collection");
    setTimeout(() => controller.abort(reason), 30);
    await expect(aborted.collectOutput({ signal: controller.signal })).rejects.toBe(reason);
    expect(aborted.status().running).toBe(false);
    expect(aborted.outputComplete()).toBe(true);
  });

  unix("rejects invalid lossless budgets before spawning", () => {
    using runtime = Runtime.load();
    for (const maxOutputBytes of [0, -1, 1.5, 64 * 1024 * 1024 + 1, NaN]) {
      expect(() =>
        runtime.spawn({
          program: "true",
          stdio: "capture-lossless",
          maxOutputBytes,
        }),
      ).toThrow(RangeError);
    }
    expect(() => runtime.spawn({ program: "true", stdio: "capture", maxOutputBytes: 100 })).toThrow(RangeError);
  });

  unix("repeated runtime unload joins capture workers with a live child", () => {
    for (let index = 0; index < 20; index++) {
      const runtime = Runtime.load();
      const child = runtime.spawn({
        program: "sleep",
        args: ["60"],
        stdio: "capture",
      });
      const pid = child.pid;
      runtime.close();
      expect(() => process.kill(-pid, 0)).toThrow();
    }
  });

  unix("waitForStdoutLine rejects when the process exits without a line", async () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sh",
      args: ["-c", "exit 4"],
      stdio: "capture",
    });
    await expect(child.waitForStdoutLine({ timeoutMs: 5000 })).rejects.toBeInstanceOf(ProcessExitedError);
  });

  unix("stopAsync keeps the event loop responsive and waitForExit resolves", async () => {
    using runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sh",
      args: ["-c", "sleep 60 & wait"],
      stdio: "null",
    });
    await Bun.sleep(100);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    const exited = child.waitForExit();
    const status = await child.stopAsync(2000);
    clearInterval(timer);
    expect(status).toMatchObject({ running: false, signal: 15 });
    expect(await exited).toBe(-1);
    expect(ticks).toBeGreaterThanOrEqual(0);
  });

  unix("waitForHttp can require a successful status", async () => {
    using runtime = Runtime.load();
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("x", { status: ++hits < 3 ? 503 : 200 }),
    });
    try {
      using child = runtime.spawn({
        program: "sleep",
        args: ["30"],
        stdio: "null",
      });
      const code = await child.waitForHttp({
        port: server.port as number,
        timeoutMs: 5000,
        accept: status => status >= 200 && status < 300,
      });
      expect(code).toBe(200);
      expect(hits).toBeGreaterThanOrEqual(3);
    } finally {
      await server.stop(true);
    }
  });

  unix("closing the runtime stops its processes", () => {
    const runtime = Runtime.load();
    const child = runtime.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "null",
    });
    const pid = child.pid;
    runtime.close();
    expect(() => process.kill(-pid, 0)).toThrow();
  });

  it("imports runtime:process through the preload plugin", async () => {
    const { processes } = await import("runtime:process");
    expect(await processes.probeHttp("127.0.0.1", 9)).toBeUndefined();
  });

  unix("the SDK-owned shared supervisor has room for processes and readiness probes", async () => {
    const { processes } = await import("../../runtime/src/modules");
    using first = processes.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "null",
    });
    using second = processes.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "null",
    });
    using third = processes.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "null",
    });
    using fourth = processes.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "null",
    });
    using fifth = processes.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "null",
    });
    expect(await processes.probeHttp("127.0.0.1", 9, "/", 20)).toBeUndefined();
    expect([first, second, third, fourth, fifth].every(child => child.status().running)).toBe(true);
  });

  it("reports spawn failures as structured errors", () => {
    using runtime = Runtime.load();
    try {
      runtime.spawn({ program: "/nonexistent/binary" });
      throw new Error("spawn must fail");
    } catch (error) {
      expect((error as RuntimeError).status).toBe(Status.Internal);
      expect((error as RuntimeError).message).toContain("cannot spawn");
    }
  });
});

suite("process lifetime across runtime close", () => {
  it("closing a runtime during an HTTP probe rejects before calling unloaded native code", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async () => {
        await Bun.sleep(50);
        return new Response("ready");
      },
    });
    const runtime = Runtime.load();
    try {
      const pending = runtime.probeHttp("127.0.0.1", server.port!, "/", 100);
      runtime.close();
      await expect(pending).rejects.toMatchObject({
        status: Status.InvalidHandle,
      });
    } finally {
      runtime.close();
      await server.stop(true);
    }
  });
  const unix = process.platform !== "win32" ? it : it.skip;
  unix("closing a runtime during collection rejects without calling unloaded native code", async () => {
    const runtime = Runtime.load();
    using child = runtime.spawn({
      program: "sleep",
      args: ["60"],
      stdio: "capture-lossless",
    });
    const pending = child.collectOutput();
    runtime.close();
    expect(runtime.closed).toBe(true);
    await expect(pending).rejects.toMatchObject({
      status: Status.InvalidHandle,
    });
    expect(() => child.status()).toThrow(RuntimeError);
    expect(() => child.takeStdoutBytes()).toThrow(RuntimeError);
    expect(() => process.kill(-child.pid, 0)).toThrow();
  });
});
