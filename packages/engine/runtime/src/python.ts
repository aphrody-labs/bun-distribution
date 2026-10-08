/**
 * In-process Python through the shared libpython hosted by `libaphrody` (`aphrody_py_*`,
 * crates/interop/ffi/src/python_ffi.rs; docs/plans/vu/PLAN.md D18).
 *
 * One CPython per process: the library of the installed `vu` artifact, opened `RTLD_GLOBAL` (process-wide
 * `LoadLibraryW` on Windows) by the Rust host, so the Bun fork, `libaphrody` and any PyO3 extension share it.
 * The artifact is loaded, never linked; nothing here starts a second interpreter.
 */
import { CString, dlopen, FFIType, ptr, read, type Pointer } from "bun:ffi";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultLibraryPath } from "./index.ts";

export const PyStatus = {
  Ok: 0,
  Arg: -1,
  Load: -2,
  State: -3,
  Python: -4,
  Panic: -5,
  Unsupported: -6,
} as const;

export class PythonError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PythonError";
    this.status = status;
  }
}

const SYMBOLS = {
  aphrody_py_load: { args: [FFIType.cstring], returns: FFIType.i32 },
  aphrody_py_init: { args: [], returns: FFIType.i32 },
  aphrody_py_run: { args: [FFIType.cstring], returns: FFIType.i32 },
  aphrody_py_eval: { args: [FFIType.cstring, FFIType.ptr], returns: FFIType.i32 },
  aphrody_py_call: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  aphrody_py_version: { args: [FFIType.ptr], returns: FFIType.i32 },
  aphrody_py_finalize: { args: [], returns: FFIType.i32 },
  aphrody_py_last_error: { args: [], returns: FFIType.ptr },
  aphrody_py_string_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

type Symbols = ReturnType<typeof dlopen<typeof SYMBOLS>>["symbols"];

const VU_TARGETS: Record<string, string> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const LIBPYTHON = /^(lib)?python3\.?\d+(\.so(\.1\.0)?|\.dylib|\.dll)$/;

/**
 * The libpython of the active `vu` artifact (`$VU_HOME`, default `~/.vu`, `runtime/<target>/current`), or null.
 * `APHRODY_LIBPYTHON` wins when set.
 */
export function vuLibpython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env["APHRODY_LIBPYTHON"];
  if (explicit !== undefined && explicit !== "") return explicit;
  const target = VU_TARGETS[`${process.platform}-${process.arch}`];
  if (target === undefined) return null;
  const home =
    env["VU_HOME"] !== undefined && env["VU_HOME"] !== ""
      ? resolve(env["VU_HOME"])
      : join(homedir(), ".vu");
  try {
    return libpythonIn(realpathSync(join(home, "runtime", target, "current")));
  } catch {
    return null;
  }
}

/** The libpython inside a `vu` artifact directory (`lib/` on Unix, the root or `bin/` on Windows), or null. */
export function libpythonIn(current: string): string | null {
  for (const dir of process.platform === "win32" ? [current, join(current, "bin")] : [join(current, "lib")]) {
    if (!existsSync(dir)) continue;
    const name = readdirSync(dir)
      .filter((file) => LIBPYTHON.test(file))
      .sort((a, b) => b.length - a.length)[0];
    if (name !== undefined) return join(dir, name);
  }
  return null;
}

function takeString(symbols: Symbols, raw: Pointer | bigint | number | null): string {
  if (raw === null || raw === 0 || raw === 0n) return "";
  try {
    return new CString(raw as Pointer).toString();
  } finally {
    symbols.aphrody_py_string_free(raw as Pointer);
  }
}

const cstr = (text: string): Uint8Array => new TextEncoder().encode(`${text}\0`);

/** The shared interpreter. `Python.open()` loads `libaphrody`, the `vu` libpython and initialises (or attaches). */
export class Python implements Disposable {
  readonly #symbols: Symbols;
  readonly #close: () => void;
  /** True when this process started the interpreter (and so finalises it on dispose). */
  readonly started: boolean;

  private constructor(symbols: Symbols, close: () => void, started: boolean) {
    this.#symbols = symbols;
    this.#close = close;
    this.started = started;
  }

  static open(options: { libraryPath?: string; libpython?: string | null } = {}): Python {
    const lib = dlopen(options.libraryPath ?? defaultLibraryPath(), SYMBOLS);
    const symbols = lib.symbols;
    const libpython = options.libpython === undefined ? vuLibpython() : options.libpython;
    const fail = (status: number): never => {
      const message = takeString(symbols, symbols.aphrody_py_last_error());
      lib.close();
      throw new PythonError(status, message || `aphrody_py status ${status}`);
    };
    const loaded = symbols.aphrody_py_load(libpython === null ? null : ptr(cstr(libpython)));
    if (loaded !== PyStatus.Ok) fail(loaded);
    const init = symbols.aphrody_py_init();
    if (init < 0) fail(init);
    return new Python(symbols, () => lib.close(), init === 1);
  }

  #check(status: number): void {
    if (status !== PyStatus.Ok) {
      throw new PythonError(status, takeString(this.#symbols, this.#symbols.aphrody_py_last_error()));
    }
  }

  #out(call: (out: Pointer) => number): string {
    const slot = new BigUint64Array(1);
    this.#check(call(ptr(slot)));
    const raw = read.ptr(ptr(slot), 0) as Pointer | 0;
    return raw === 0 ? "" : takeString(this.#symbols, raw);
  }

  /** `Py_GetVersion()`. */
  version(): string {
    return this.#out((out) => this.#symbols.aphrody_py_version(out));
  }

  /** Runs statements in `__main__`. */
  run(code: string): void {
    this.#check(this.#symbols.aphrody_py_run(ptr(cstr(code))));
  }

  /** Evaluates an expression in `__main__` and returns `str(result)`. */
  eval(expression: string): string {
    return this.#out((out) => this.#symbols.aphrody_py_eval(ptr(cstr(expression)), out));
  }

  /** `module.function(arg)` (no argument when `arg` is undefined), returns `str(result)`. */
  call(module: string, fn: string, arg?: string): string {
    const argument = arg === undefined ? null : ptr(cstr(arg));
    return this.#out((out) =>
      this.#symbols.aphrody_py_call(ptr(cstr(module)), ptr(cstr(fn)), argument, out),
    );
  }

  /** Finalises the interpreter when this process started it, then closes `libaphrody`. */
  close(): void {
    this.#symbols.aphrody_py_finalize();
    this.#close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
