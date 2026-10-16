/**
 * Light SDK of the YOLO native runtime (phase R0 slice).
 *
 * Loads the precompiled `aphrody_ffi` library through `bun:ffi` and its versioned yolo_* C ABI
 * (declared in the single header `crates/interop/ffi/include/aphrody.h`, contract in
 * `docs/architecture/runtime-native/RUNTIME-ABI.md`). Nothing here compiles or
 * links Tauri, CEF, Bun internals or Obscura: the consumer only needs this file and the
 * prebuilt artifact.
 */
import { dlopen, FFIType, ptr, read, suffix, toArrayBuffer, type Pointer } from "bun:ffi";
import { embeddedNativeLibraryPath } from "./ffi.ts";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** ABI major this SDK was written for. A library with another major is refused before any call. */
export const EXPECTED_ABI_MAJOR = 1;
export const EXPECTED_ABI_MINOR = 4;

export const Status = {
  Ok: 0,
  InvalidArgument: 1,
  AbiMismatch: 2,
  InvalidHandle: 3,
  Cancelled: 4,
  Timeout: 5,
  Busy: 6,
  Internal: 7,
  Panic: 8,
  OutputLimit: 9,
} as const;
export type StatusCode = (typeof Status)[keyof typeof Status];

const STATUS_NAMES = Object.fromEntries(Object.entries(Status).map(([k, v]) => [v, k])) as Record<
  number,
  string
>;

export class RuntimeError extends Error {
  readonly status: number;
  readonly statusName: string;
  constructor(status: number, message: string) {
    const statusName = STATUS_NAMES[status] ?? `Unknown(${status})`;
    super(`${statusName}: ${message}`);
    this.name = "RuntimeError";
    this.status = status;
    this.statusName = statusName;
  }
}

export interface BuildInfo {
  readonly name: string;
  readonly version: string;
  readonly abi: string;
  readonly target: string;
  readonly rustc: string;
  readonly git_rev: string;
  readonly panic_recovery: boolean;
}

export interface SystemStats {
  readonly os: string;
  readonly arch: string;
  readonly timestamp_ms: number;
}

export interface BenchmarkResult {
  readonly message: string;
  readonly latency_us: number;
}

export interface LoadOptions {
  /** Explicit provider; otherwise use the environment, embedded provider or installed artifact. */
  readonly libraryPath?: string;
  /** Maximum concurrent operations of the runtime (library default when omitted). */
  readonly maxOperations?: number;
}

const BUFFER_BYTES = 24; // YoloBuffer { data: *mut u8, len: usize, cap: usize } on 64-bit targets

/** File name of the sole native cdylib (`aphrody-ffi`, which re-exports the yolo_* ABI): `libaphrody_ffi.so|dylib`, `aphrody_ffi.dll` on Windows. */
export function libraryFile(): string {
  return process.platform === "win32" ? "aphrody_ffi.dll" : `libaphrody_ffi.${suffix}`;
}

/**
 * Resolution order: `$YOLO_RUNTIME_LIB`, the embedded sole FFI provider, the active installed artifact
 * (`$YOLO_RUNTIME_HOME` or `$YOLO_HOME/runtime`, default `~/.yolo/runtime`, `<target>/current`), then the local `$CARGO_TARGET_DIR/runtime/` (default `target/runtime/`).
 */
export function defaultLibraryPath(): string {
  const fromEnv = process.env["YOLO_RUNTIME_LIB"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const embedded = embeddedNativeLibraryPath("aphrody_ffi");
  if (embedded !== null) return embedded;
  const runtimeHomeEnv = process.env["YOLO_RUNTIME_HOME"];
  const yoloHome = process.env["YOLO_HOME"];
  const base =
    runtimeHomeEnv !== undefined && runtimeHomeEnv !== ""
      ? resolve(runtimeHomeEnv)
      : yoloHome !== undefined && yoloHome !== ""
        ? resolve(yoloHome, "runtime")
        : join(homedir(), ".yolo", "runtime");
  const current = resolve(base, installedTarget(), "current");
  const installed = join(current, libraryFile());
  if (existsSync(installed)) return installed;
  // A release artifact names its shared library in its manifest (`libyolo_runtime.so`).
  try {
    const manifest = JSON.parse(readFileSync(join(current, "manifest.json"), "utf8")) as {
      files?: Record<string, unknown>;
    };
    const name = Object.keys(manifest.files ?? {}).find((file) => /\.(so|dylib|dll)$/.test(file));
    if (name !== undefined && existsSync(join(current, name))) return join(current, name);
  } catch {
    // no installed artifact: fall through to the local build
  }
  const target =
    process.env["CARGO_TARGET_DIR"] || resolve(import.meta.dir, "../../../docs/aphrody", "target");
  return resolve(target, "runtime", libraryFile());
}

function installedTarget(): string {
  const targets: Record<string, string> = {
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  return targets[`${process.platform}-${process.arch}`] ?? "unsupported";
}

/** bun:ffi table of the yolo_* ABI; test/runtime-ffi.test.ts keeps it in step with aphrody.h. */
export const SYMBOLS = {
  yolo_abi_version: { args: [], returns: FFIType.u32 },
  yolo_runtime_create: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  yolo_runtime_destroy: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_runtime_build_info: { args: [FFIType.ptr], returns: FFIType.i32 },
  yolo_runtime_capabilities: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  yolo_system_stats: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  yolo_bench_start: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  yolo_operation_wait: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  yolo_operation_cancel: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_operation_release: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_process_spawn: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  yolo_process_status: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  yolo_process_read: {
    args: [FFIType.u64, FFIType.u32, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  yolo_process_stop: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
  yolo_process_stop_start: {
    args: [FFIType.u64, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  yolo_process_output_complete: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  yolo_process_release: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_http_probe_start: {
    args: [FFIType.u64, FFIType.ptr, FFIType.u16, FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  yolo_buffer_free: { args: [FFIType.ptr], returns: FFIType.void },
  yolo_last_error: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const;

type Library = ReturnType<typeof dlopen<typeof SYMBOLS>>;
type Symbols = Library["symbols"];

function readBufferBytes(symbols: Symbols, buffer: Uint8Array): Uint8Array {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const dataPtr = read.ptr(ptr(buffer), 0);
  const len = Number(view.getBigUint64(8, true));
  try {
    // Copy before releasing: returned bytes must outlive the native allocation.
    return dataPtr && len > 0
      ? new Uint8Array(toArrayBuffer(dataPtr, 0, len)).slice()
      : new Uint8Array(0);
  } finally {
    symbols.yolo_buffer_free(ptr(buffer));
  }
}

function readBuffer(symbols: Symbols, buffer: Uint8Array): string {
  return new TextDecoder().decode(readBufferBytes(symbols, buffer));
}

function lastError(symbols: Symbols): string {
  const buffer = new Uint8Array(BUFFER_BYTES);
  if (symbols.yolo_last_error(ptr(buffer)) !== Status.Ok) return "unknown error";
  try {
    return (JSON.parse(readBuffer(symbols, buffer)) as { message: string }).message;
  } catch {
    return "unknown error";
  }
}

function check(symbols: Symbols, status: number): void {
  if (status !== Status.Ok) throw new RuntimeError(status, lastError(symbols));
}

function callJson<T>(symbols: Symbols, call: (out: Pointer) => number): T {
  const buffer = new Uint8Array(BUFFER_BYTES);
  check(symbols, call(ptr(buffer)));
  return JSON.parse(readBuffer(symbols, buffer)) as T;
}

export interface SpawnOptions {
  readonly program: string;
  readonly args?: readonly string[];
  /** Added to the inherited environment; an `undefined` value removes the variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  /**
   * `"null"` connects stdin/stdout/stderr to the null device, `"capture"` keeps the last 64 KiB of
   * stdout and stderr for `takeStdout()` / `stderrTail()`; default inherits them.
   */
  readonly stdio?: "inherit" | "null" | "capture" | "capture-lossless";
  /** Total bytes allowed per stream in lossless mode (1..64 MiB, default 64 MiB). */
  readonly maxOutputBytes?: number;
}

export interface ProcessStatus {
  readonly running: boolean;
  /** Exit code; -1 when the process was terminated by a signal. */
  readonly exitCode: number;
  readonly signal: number;
  readonly pid: number;
}

export interface ProcessOutput {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly status: ProcessStatus;
}

export interface HttpReadyOptions {
  readonly host?: string;
  readonly port: number;
  readonly path?: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
  /** Accepts a response status as "ready"; default: any answer. */
  readonly accept?: (statusCode: number) => boolean;
}

/** The supervised process exited before the awaited condition held. */
export class ProcessExitedError extends Error {
  readonly status: ProcessStatus;
  constructor(status: ProcessStatus) {
    super(
      `process ${status.pid} exited before it was ready (code ${status.exitCode}, signal ${status.signal})`,
    );
    this.name = "ProcessExitedError";
    this.status = status;
  }
}

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

const cString = (text: string): Buffer => Buffer.from(`${text}\0`, "utf8");

/** A NULL-terminated array of C strings; `keep` holds the buffers alive during the call. */
function cStringArray(items: readonly string[], keep: Buffer[]): Uint8Array {
  const table = new DataView(new ArrayBuffer((items.length + 1) * 8));
  items.forEach((item, index) => {
    const buffer = cString(item);
    keep.push(buffer);
    table.setBigUint64(index * 8, BigInt(ptr(buffer)), true);
  });
  return new Uint8Array(table.buffer);
}

/** A supervised child process (own process group). Always `release()` it (or use `using`). */
export class ManagedProcess implements Disposable {
  #symbols: Symbols;
  #runtime: Runtime;
  #handle: bigint;
  #released = false;
  readonly pid: number;

  constructor(symbols: Symbols, runtime: Runtime, handle: bigint, pid: number) {
    this.#symbols = symbols;
    this.#runtime = runtime;
    this.#handle = handle;
    this.pid = pid;
  }

  #assertLive(): void {
    if (this.#released || this.#runtime.closed) {
      throw new RuntimeError(
        Status.InvalidHandle,
        "process handle is released or its runtime is closed",
      );
    }
  }

  status(): ProcessStatus {
    this.#assertLive();
    const out = new Uint32Array(5);
    out[0] = 20; // struct_size
    check(this.#symbols, this.#symbols.yolo_process_status(this.#handle, ptr(out)));
    const view = new Int32Array(out.buffer);
    return {
      running: out[1] === 0,
      exitCode: out[1] === 0 ? 0 : (view[2] as number),
      signal: view[3] as number,
      pid: out[4] as number,
    };
  }

  #readBytes(stream: 1 | 2, mode: 0 | 1): Uint8Array {
    this.#assertLive();
    const buffer = new Uint8Array(BUFFER_BYTES);
    check(this.#symbols, this.#symbols.yolo_process_read(this.#handle, stream, mode, ptr(buffer)));
    return readBufferBytes(this.#symbols, buffer);
  }

  #read(stream: 1 | 2, mode: 0 | 1): string {
    return new TextDecoder().decode(this.#readBytes(stream, mode));
  }

  /** Returns and clears stdout without UTF-8 decoding. Capture mode controls its budget. */
  takeStdoutBytes(): Uint8Array {
    return this.#readBytes(1, 0);
  }

  /** Returns and clears stderr without UTF-8 decoding. Capture mode controls its budget. */
  takeStderrBytes(): Uint8Array {
    return this.#readBytes(2, 0);
  }

  /** True when both capture workers have finished; reads can still report a capture error. */
  outputComplete(): boolean {
    this.#assertLive();
    const out = new Uint32Array(1);
    check(this.#symbols, this.#symbols.yolo_process_output_complete(this.#handle, ptr(out)));
    return out[0] === 1;
  }

  /**
   * Collects captured bytes through process exit and terminal drain. Use capture-lossless for
   * complete responses. Timeout, abort and output-limit failures stop the owned child before
   * rejecting. The caller still owns the handle and must release it.
   */
  async collectOutput(
    options: {
      timeoutMs?: number;
      pollMs?: number;
      signal?: AbortSignal;
      /** Receives copied stderr chunks, including diagnostics before failure. */
      onStderr?: (bytes: Uint8Array) => void;
    } = {},
  ): Promise<ProcessOutput> {
    const { timeoutMs = 30_000, pollMs = 5, signal } = options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
      throw new RangeError("timeoutMs and pollMs must be positive finite numbers");
    }
    const deadline = Date.now() + timeoutMs;
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    let stopped = false;
    const drain = (): void => {
      const err = this.takeStderrBytes();
      if (err.length) {
        stderr.push(err);
        options.onStderr?.(err);
      }
      const out = this.takeStdoutBytes();
      if (out.length) stdout.push(out);
    };
    try {
      for (;;) {
        signal?.throwIfAborted();
        drain();
        if (!this.status().running) {
          // oxlint-disable-next-line no-await-in-loop -- single-shot: this await ends the loop right after the process is observed stopped, so it runs once
          const status = await this.stopAsync(0);
          stopped = true;
          signal?.throwIfAborted();
          drain();
          return { stdout: concat(stdout), stderr: concat(stderr), status };
        }
        if (Date.now() >= deadline) {
          throw new RuntimeError(Status.Timeout, `process timed out after ${timeoutMs} ms`);
        }
        // oxlint-disable-next-line no-await-in-loop -- poll loop: native state is re-read after each sleep, so iterations depend on the previous result
        await new Promise((done) => setTimeout(done, pollMs));
      }
    } finally {
      if (!stopped && !this.#released && !this.#runtime.closed) await this.stopAsync(0);
    }
  }

  /** Returns and clears the captured stdout (needs `stdio: "capture"`). */
  takeStdout(): string {
    return this.#read(1, 0);
  }

  /** Returns and clears the captured stderr (needs `stdio: "capture"`). */
  takeStderr(): string {
    return this.#read(2, 0);
  }

  /** The last captured stderr bytes (at most 64 KiB), without clearing them. */
  stderrTail(maxBytes = 8192): string {
    return this.#read(2, 1).slice(-maxBytes);
  }

  /**
   * Resolves with the first stdout line (needs `stdio: "capture"`). Rejects with
   * `ProcessExitedError` if the process exits with no line, on timeout or on abort.
   */
  async waitForStdoutLine(
    options: { timeoutMs?: number; signal?: AbortSignal; pollMs?: number } = {},
  ): Promise<string> {
    const { timeoutMs = 10_000, signal, pollMs = 5 } = options;
    const deadline = Date.now() + timeoutMs;
    let seen = "";
    for (;;) {
      signal?.throwIfAborted();
      seen += this.takeStdout();
      const newline = seen.indexOf("\n");
      if (newline >= 0) return seen.slice(0, newline).trim();
      const status = this.status();
      if (!status.running) {
        seen += this.takeStdout();
        if (seen.includes("\n")) return seen.slice(0, seen.indexOf("\n")).trim();
        throw new ProcessExitedError(status);
      }
      if (Date.now() >= deadline) throw new Error(`no stdout line after ${timeoutMs} ms`);
      // oxlint-disable-next-line no-await-in-loop -- poll loop: native state is re-read after each sleep, so iterations depend on the previous result
      await new Promise((done) => setTimeout(done, pollMs));
    }
  }

  /**
   * Like `stop()` but the SIGTERM / grace / SIGKILL sequence runs on a native worker, so the event
   * loop is never blocked. Resolves with the final status.
   */
  async stopAsync(graceMs = 2000): Promise<ProcessStatus> {
    this.#assertLive();
    const out = new BigUint64Array(1);
    check(this.#symbols, this.#symbols.yolo_process_stop_start(this.#handle, graceMs, ptr(out)));
    const operation = new Operation(this.#symbols, out[0] as bigint, this.#runtime);
    try {
      while (operation.waitRaw(0) === undefined) {
        // oxlint-disable-next-line no-await-in-loop -- poll loop: native state is re-read after each sleep, so iterations depend on the previous result
        await new Promise((done) => setTimeout(done, 5));
      }
    } finally {
      operation.release();
    }
    return this.status();
  }

  /** Resolves with the exit code once the process has exited (polls; never blocks). */
  async waitForExit(options: { pollMs?: number; signal?: AbortSignal } = {}): Promise<number> {
    const { pollMs = 25, signal } = options;
    for (;;) {
      signal?.throwIfAborted();
      const status = this.status();
      if (!status.running) return status.exitCode;
      // oxlint-disable-next-line no-await-in-loop -- poll loop: native state is re-read after each sleep, so iterations depend on the previous result
      await new Promise((done) => setTimeout(done, pollMs));
    }
  }

  /** SIGTERM to the process group, SIGKILL after `graceMs`; waits and keeps the handle valid. */
  stop(graceMs = 2000): ProcessStatus {
    this.#assertLive();
    check(this.#symbols, this.#symbols.yolo_process_stop(this.#handle, graceMs));
    return this.status();
  }

  /**
   * Resolves once the server answers over HTTP. Rejects with `ProcessExitedError` if the process
   * exits first, with the abort reason on abort, and with a timeout `Error` otherwise. Never blocks
   * the event loop for more than one probe.
   */
  async waitForHttp(options: HttpReadyOptions): Promise<number> {
    const {
      host = "127.0.0.1",
      port,
      path = "/",
      timeoutMs = 10_000,
      intervalMs = 50,
      signal,
      accept,
    } = options;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const status = this.status();
      if (!status.running) throw new ProcessExitedError(status);
      // oxlint-disable-next-line no-await-in-loop -- probe loop: each HTTP probe must complete before the next, bounded by the shared deadline
      const code = await this.#runtime.probeHttp(
        host,
        port,
        path,
        Math.min(500, Math.max(1, deadline - Date.now())),
      );
      if (code !== undefined && (accept === undefined || accept(code))) return code;
      if (Date.now() >= deadline) {
        throw new Error(`http://${host}:${port}${path} not ready after ${timeoutMs} ms`);
      }
      // oxlint-disable-next-line no-await-in-loop -- poll loop: native state is re-read after each sleep, so iterations depend on the previous result
      await new Promise((done) => setTimeout(done, intervalMs));
    }
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    if (!this.#runtime.closed) {
      check(this.#symbols, this.#symbols.yolo_process_release(this.#handle));
    }
  }

  [Symbol.dispose](): void {
    this.release();
  }
}

/** A started native operation. Always `release()` it (or use `using`). */
export class Operation implements Disposable {
  #symbols: Symbols;
  #handle: bigint;
  #released = false;
  #runtime: Runtime | undefined;

  constructor(symbols: Symbols, handle: bigint, runtime?: Runtime) {
    this.#symbols = symbols;
    this.#handle = handle;
    this.#runtime = runtime;
  }

  #assertLive(): void {
    if (this.#released || this.#runtime?.closed) {
      throw new RuntimeError(
        Status.InvalidHandle,
        "operation handle is released or its runtime is closed",
      );
    }
  }

  /** Waits up to `timeoutMs`. Resolves to `undefined` on timeout (the operation keeps running). */
  wait(timeoutMs = 0): BenchmarkResult | undefined {
    const raw = this.waitRaw(timeoutMs);
    return raw === undefined ? undefined : (JSON.parse(raw) as BenchmarkResult);
  }

  /** Like `wait`, returning the raw JSON text of the result. */
  waitRaw(timeoutMs = 0): string | undefined {
    this.#assertLive();
    const buffer = new Uint8Array(BUFFER_BYTES);
    const status = this.#symbols.yolo_operation_wait(this.#handle, timeoutMs, ptr(buffer));
    if (status === Status.Timeout) return undefined;
    check(this.#symbols, status);
    return readBuffer(this.#symbols, buffer);
  }

  /** Requests cancellation; `wait()` then throws a `Cancelled` RuntimeError. */
  cancel(): void {
    this.#assertLive();
    check(this.#symbols, this.#symbols.yolo_operation_cancel(this.#handle));
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    if (!this.#runtime?.closed) {
      check(this.#symbols, this.#symbols.yolo_operation_release(this.#handle));
    }
  }

  [Symbol.dispose](): void {
    this.release();
  }
}

/** A loaded runtime instance. `close()` cancels and joins every operation it owns. */
export class Runtime implements Disposable {
  #library: Library;
  #handle: bigint;
  #closed = false;
  readonly abi: { major: number; minor: number };

  private constructor(library: Library, handle: bigint, abi: { major: number; minor: number }) {
    this.#library = library;
    this.#handle = handle;
    this.abi = abi;
  }

  static load(options: LoadOptions = {}): Runtime {
    const path = options.libraryPath ?? defaultLibraryPath();
    if (!existsSync(path)) {
      throw new Error(
        `YOLO runtime library not found at ${path}. Build it with \`just yolo::runtime-build\` ` +
          `(\`cargo build --profile runtime -p aphrody-ffi --no-default-features --features browser,tooling\`) ` +
          `or point YOLO_RUNTIME_LIB to a prebuilt artifact.`,
      );
    }
    // Negotiate before binding anything else: an older library lacks symbols the SDK needs and
    // must be refused with a clear ABI error, not a missing-symbol one.
    const probe = dlopen(path, {
      yolo_abi_version: SYMBOLS.yolo_abi_version,
    });
    const version = probe.symbols.yolo_abi_version();
    probe.close();
    const major = version >>> 16;
    const minor = version & 0xffff;
    if (major !== EXPECTED_ABI_MAJOR || minor < EXPECTED_ABI_MINOR) {
      throw new RuntimeError(
        Status.AbiMismatch,
        `library implements ABI ${major}.${minor}, this SDK needs ${EXPECTED_ABI_MAJOR}.${EXPECTED_ABI_MINOR}+`,
      );
    }
    const library = dlopen(path, SYMBOLS);
    const symbols = library.symbols;

    const info = new Uint32Array([
      16,
      EXPECTED_ABI_MAJOR,
      EXPECTED_ABI_MINOR,
      options.maxOperations ?? 0,
    ]);
    const out = new BigUint64Array(1);
    try {
      check(symbols, symbols.yolo_runtime_create(ptr(info), ptr(out)));
    } catch (error) {
      library.close();
      throw error;
    }
    return new Runtime(library, out[0] as bigint, { major, minor });
  }

  /** Handles reject further calls after close without entering an unloaded library. */
  get closed(): boolean {
    return this.#closed;
  }

  #live(): Symbols {
    if (this.#closed) throw new RuntimeError(Status.InvalidHandle, "runtime is closed");
    return this.#library.symbols;
  }

  buildInfo(): BuildInfo {
    const symbols = this.#live();
    return callJson<BuildInfo>(symbols, (out) => symbols.yolo_runtime_build_info(out));
  }

  capabilities(): string[] {
    const symbols = this.#live();
    return callJson<string[]>(symbols, (out) =>
      symbols.yolo_runtime_capabilities(this.#handle, out),
    );
  }

  systemStats(): SystemStats {
    const symbols = this.#live();
    return callJson<SystemStats>(symbols, (out) => symbols.yolo_system_stats(this.#handle, out));
  }

  startBenchmark(iterations: number): Operation {
    const symbols = this.#live();
    const out = new BigUint64Array(1);
    check(symbols, symbols.yolo_bench_start(this.#handle, iterations, ptr(out)));
    return new Operation(symbols, out[0] as bigint, this);
  }

  /** Spawns a supervised process; the runtime stops it if it is still alive at `close()`. */
  spawn(options: SpawnOptions): ManagedProcess {
    const symbols = this.#live();
    const keep: Buffer[] = [];
    const program = cString(options.program);
    const args = cStringArray(options.args ?? [], keep);
    const env = cStringArray(
      Object.entries(options.env ?? {}).map(([key, value]) =>
        value === undefined ? key : `${key}=${value}`,
      ),
      keep,
    );
    const cwd = options.cwd === undefined ? undefined : cString(options.cwd);

    const lossless = options.stdio === "capture-lossless";
    const budget = options.maxOutputBytes ?? 64 * 1024 * 1024;
    if (
      (options.maxOutputBytes !== undefined && !lossless) ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 64 * 1024 * 1024
    ) {
      throw new RangeError("maxOutputBytes requires lossless capture and must be 1..64 MiB");
    }
    const info = new DataView(new ArrayBuffer(48));
    info.setUint32(0, 48, true);
    info.setBigUint64(40, lossless ? BigInt(budget) : 0n, true);
    info.setUint32(
      4,
      lossless ? 4 : options.stdio === "null" ? 1 : options.stdio === "capture" ? 2 : 0,
      true,
    );
    info.setBigUint64(8, BigInt(ptr(program)), true);
    info.setBigUint64(16, BigInt(ptr(args)), true);
    info.setBigUint64(24, BigInt(ptr(env)), true);
    info.setBigUint64(32, cwd === undefined ? 0n : BigInt(ptr(cwd)), true);

    const out = new BigUint64Array(1);
    check(
      symbols,
      symbols.yolo_process_spawn(this.#handle, ptr(new Uint8Array(info.buffer)), ptr(out)),
    );
    const handle = out[0] as bigint;
    const probe = new Uint32Array(5);
    probe[0] = 20;
    check(symbols, symbols.yolo_process_status(handle, ptr(probe)));
    return new ManagedProcess(symbols, this, handle, probe[4] as number);
  }

  /**
   * One HTTP GET on a native worker thread (the event loop is never blocked): the response status
   * code, or `undefined` when nothing answers (yet).
   */
  async probeHttp(
    host: string,
    port: number,
    path: string,
    timeoutMs = 500,
  ): Promise<number | undefined> {
    const symbols = this.#live();
    const out = new BigUint64Array(1);
    check(
      symbols,
      symbols.yolo_http_probe_start(
        this.#handle,
        ptr(cString(host)),
        port,
        ptr(cString(path)),
        timeoutMs,
        ptr(out),
      ),
    );
    const operation = new Operation(symbols, out[0] as bigint, this);
    try {
      for (;;) {
        const result = operation.waitRaw(0);
        if (result !== undefined) {
          const { status } = JSON.parse(result) as { status: number | null };
          return status ?? undefined;
        }
        // oxlint-disable-next-line no-await-in-loop -- poll loop: native state is re-read after each sleep, so iterations depend on the previous result
        await new Promise((done) => setTimeout(done, 2));
      }
    } finally {
      operation.release();
    }
  }

  /**
   * Runs a benchmark without blocking the event loop: polls the native operation, cancels it when
   * `signal` aborts (rejecting with the signal's reason) and always releases it.
   */
  async benchmark(
    iterations: number,
    options: { signal?: AbortSignal; pollMs?: number } = {},
  ): Promise<BenchmarkResult> {
    const { signal, pollMs = 5 } = options;
    signal?.throwIfAborted();
    const operation = this.startBenchmark(iterations);
    try {
      for (;;) {
        if (signal?.aborted) {
          operation.cancel();
          operation.release();
          throw signal.reason;
        }
        const result = operation.wait(0);
        if (result !== undefined) return result;
        // oxlint-disable-next-line no-await-in-loop -- poll loop: native state is re-read after each sleep, so iterations depend on the previous result
        await new Promise((done) => setTimeout(done, pollMs));
      }
    } finally {
      operation.release();
    }
  }

  close(): void {
    if (this.#closed) return;
    const symbols = this.#library.symbols;
    this.#closed = true;
    check(symbols, symbols.yolo_runtime_destroy(this.#handle));
    this.#library.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

export * from "./compute";
export * from "./privilege";
