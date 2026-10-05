/**
 * Optional precompiled Obscura browser extension. The SDK never builds an engine.
 * Native contexts own their thread, V8 isolate, network state and in-memory cookie jar.
 */
import { dlopen, FFIType, ptr, read, toArrayBuffer } from "bun:ffi";
import {
  defaultLibraryPath,
  EXPECTED_ABI_MAJOR,
  EXPECTED_ABI_MINOR,
  Runtime,
  RuntimeError,
  Status,
  type LoadOptions,
} from "./index";

export const BROWSER_CAPABILITIES = [
  "browser.navigate",
  "browser.dom",
  "browser.capture",
  "browser.contexts",
] as const;

export interface BrowserContextOptions {
  /** Exact HTTP(S) origins permitted for navigation, redirects and every network request. */
  readonly allowedOrigins: readonly string[];
  /** Explicit native SSRF opt-in; false by default. No file access is provided. */
  readonly allowPrivateNetwork?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly timeoutMs?: number;
  readonly maxResultBytes?: number;
}

export interface BrowserCallOptions {
  readonly signal?: AbortSignal;
}

export interface BrowserSnapshot {
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

export interface BrowserNavigation {
  readonly url: string;
  readonly title: string;
}

export type BrowserWaitUntil = "load" | "domcontentloaded" | "networkidle";

const SYMBOLS = {
  yolo_runtime_create: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  yolo_runtime_destroy: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_browser_create: {
    args: [FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  yolo_browser_call_start: {
    args: [FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  yolo_browser_close: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_operation_wait: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  yolo_operation_cancel: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_operation_release: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_buffer_free: { args: [FFIType.ptr], returns: FFIType.void },
  yolo_last_error: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const;

type Library = ReturnType<typeof dlopen<typeof SYMBOLS>>;
type Symbols = Library["symbols"];

function readBuffer(symbols: Symbols, buffer: Uint8Array): string {
  const length = Number(new DataView(buffer.buffer).getBigUint64(8, true));
  const data = read.ptr(ptr(buffer), 0);
  try {
    return data && length > 0 ? new TextDecoder().decode(toArrayBuffer(data, 0, length)) : "";
  } finally {
    symbols.yolo_buffer_free(ptr(buffer));
  }
}

function check(symbols: Symbols, status: number): void {
  if (status === Status.Ok) return;
  const buffer = new Uint8Array(24);
  let message = "native browser operation failed";
  if (symbols.yolo_last_error(ptr(buffer)) === Status.Ok) {
    try {
      message = (JSON.parse(readBuffer(symbols, buffer)) as { message: string }).message;
    } catch {
      // Preserve the native status if an invalid diagnostic buffer cannot be decoded.
    }
  }
  throw new RuntimeError(status, message);
}

function input(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length === 0 || bytes.length > 64 * 1024) {
    throw new RangeError("browser JSON input must contain 1..64 KiB");
  }
  return bytes;
}

/** Loader of the optional browser provider; owns and destroys every context it creates. */
export class BrowserRuntime implements Disposable {
  readonly #library: Library;
  readonly #handle: bigint;
  readonly #contexts = new Set<BrowserContext>();
  #closed = false;

  private constructor(library: Library, handle: bigint) {
    this.#library = library;
    this.#handle = handle;
  }

  static load(options: LoadOptions = {}): BrowserRuntime {
    const path = options.libraryPath ?? defaultLibraryPath();
    // ABI and capabilities are negotiated using existing symbols before binding any extension.
    // Existing ABI 1.4 core artifacts continue to load without browser symbols.
    using probe = Runtime.load(options);
    const missing = BROWSER_CAPABILITIES.filter(
      (capability) => !probe.capabilities().includes(capability),
    );
    if (missing.length > 0) {
      throw new RuntimeError(
        Status.AbiMismatch,
        "the precompiled runtime does not provide browser capabilities; install a browser-enabled release",
      );
    }
    const library = dlopen(path, SYMBOLS);
    const createInfo = new Uint32Array([
      16,
      EXPECTED_ABI_MAJOR,
      EXPECTED_ABI_MINOR,
      options.maxOperations ?? 32,
    ]);
    const out = new BigUint64Array(1);
    try {
      check(library.symbols, library.symbols.yolo_runtime_create(ptr(createInfo), ptr(out)));
      return new BrowserRuntime(library, out[0] as bigint);
    } catch (error) {
      library.close();
      throw error;
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  createContext(options: BrowserContextOptions): BrowserContext {
    this.#assertLive();
    const bytes = input(options);
    const out = new BigUint64Array(1);
    check(
      this.#library.symbols,
      this.#library.symbols.yolo_browser_create(this.#handle, ptr(bytes), bytes.length, ptr(out)),
    );
    const context = new BrowserContext(this, out[0] as bigint);
    this.#contexts.add(context);
    return context;
  }

  #assertLive(): void {
    if (this.#closed) throw new RuntimeError(Status.InvalidHandle, "browser runtime is closed");
  }

  /** Internal SDK boundary. Context handles are meaningful only to this loaded provider. */
  async call<T>(handle: bigint, command: unknown, options: BrowserCallOptions = {}): Promise<T> {
    this.#assertLive();
    options.signal?.throwIfAborted();
    const symbols = this.#library.symbols;
    const bytes = input(command);
    const out = new BigUint64Array(1);
    check(symbols, symbols.yolo_browser_call_start(handle, ptr(bytes), bytes.length, ptr(out)));
    const operation = out[0] as bigint;
    const cancel = (): void => {
      if (!this.#closed) symbols.yolo_operation_cancel(operation);
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        this.#assertLive();
        const buffer = new Uint8Array(24);
        const status = symbols.yolo_operation_wait(operation, 0, ptr(buffer));
        if (status !== Status.Timeout) {
          // Free a successful native result even if an abort arrived just before this poll.
          const raw = status === Status.Ok ? readBuffer(symbols, buffer) : undefined;
          options.signal?.throwIfAborted();
          check(symbols, status);
          return JSON.parse(raw as string) as T;
        }
        if (options.signal?.aborted) cancel();
        await Bun.sleep(10);
      }
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      if (!this.#closed) check(symbols, symbols.yolo_operation_release(operation));
    }
  }

  /** Internal SDK boundary; closes and joins this provider's context before forgetting it. */
  release(context: BrowserContext, handle: bigint): void {
    if (this.#closed) return;
    check(this.#library.symbols, this.#library.symbols.yolo_browser_close(handle));
    this.#contexts.delete(context);
  }

  close(): void {
    if (this.#closed) return;
    // Destroy handles and join native workers before unloading the extension.
    check(this.#library.symbols, this.#library.symbols.yolo_runtime_destroy(this.#handle));
    this.#closed = true;
    for (const context of this.#contexts) context.invalidate();
    this.#contexts.clear();
    this.#library.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** One isolated remote-page realm. Origin permissions are immutable after creation. */
export class BrowserContext implements Disposable {
  readonly #runtime: BrowserRuntime;
  readonly #handle: bigint;
  #closed = false;

  constructor(runtime: BrowserRuntime, handle: bigint) {
    this.#runtime = runtime;
    this.#handle = handle;
  }

  get closed(): boolean {
    return this.#closed || this.#runtime.closed;
  }

  #call<T>(command: unknown, options?: BrowserCallOptions): Promise<T> {
    if (this.closed)
      return Promise.reject(new RuntimeError(Status.InvalidHandle, "browser context is closed"));
    return this.#runtime.call<T>(this.#handle, command, options);
  }

  navigate(
    url: string,
    options: BrowserCallOptions & { waitUntil?: BrowserWaitUntil } = {},
  ): Promise<BrowserNavigation> {
    return this.#call({ method: "navigate", url, waitUntil: options.waitUntil ?? "load" }, options);
  }

  snapshot(options?: BrowserCallOptions): Promise<BrowserSnapshot> {
    return this.#call({ method: "snapshot" }, options);
  }

  content(options?: BrowserCallOptions): Promise<string> {
    return this.#call({ method: "content" }, options);
  }

  extract(selector: string, options?: BrowserCallOptions): Promise<string[]> {
    return this.#call({ method: "extract", selector }, options);
  }

  async screenshot(options?: BrowserCallOptions): Promise<Uint8Array> {
    const result = await this.#call<{ mimeType: string; data: string }>(
      { method: "screenshot" },
      options,
    );
    if (result.mimeType !== "image/png")
      throw new Error("native browser returned an unsupported capture");
    return new Uint8Array(Buffer.from(result.data, "base64"));
  }

  evaluate<T>(expression: string, options?: BrowserCallOptions): Promise<T> {
    return this.#call({ method: "evaluate", expression }, options);
  }

  /** Cookie-jar mutation requires an allowed URL; no global authentication is imported. */
  setCookie(url: string, cookie: string, options?: BrowserCallOptions): Promise<null> {
    return this.#call({ method: "setCookie", url, cookie }, options);
  }

  cookies(url: string, options?: BrowserCallOptions): Promise<string> {
    return this.#call({ method: "cookies", url }, options);
  }

  clearCookies(options?: BrowserCallOptions): Promise<null> {
    return this.#call({ method: "clearCookies" }, options);
  }

  /** Internal SDK invalidation after owner destruction. */
  invalidate(): void {
    this.#closed = true;
  }

  close(): void {
    if (this.#closed) return;
    this.#runtime.release(this, this.#handle);
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
