/**
 * Optional precompiled GPU extension (ABI 1.5). The native runtime owns one process-wide device
 * (NVIDIA discrete GPU first) shared with every other host of the process: Obscura contexts
 * created through `./browser` and Tauri plugins linked into the same binary use the same device.
 * The SDK never builds an engine and never touches the driver directly.
 */
import { dlopen, FFIType, ptr, read, toArrayBuffer } from "bun:ffi";
import {
  defaultLibraryPath,
  EXPECTED_ABI_MAJOR,
  Runtime,
  RuntimeError,
  Status,
  type LoadOptions,
} from "./index";

/** The GPU symbol first shipped in ABI 1.5. */
export const GPU_ABI_MINOR = 5;
export const GPU_CAPABILITIES = ["gpu.info", "gpu.wgsl"] as const;
export const CUDA_CAPABILITY = "gpu.cuda";
/** Native bounds, mirrored to fail fast before crossing the ABI. */
export const MAX_GPU_DATA_BYTES = 16 * 1024 * 1024;
const MAX_COMMAND_BYTES = 1024 * 1024;

export interface GpuAdapter {
  readonly name: string;
  readonly vendor: number;
  readonly device: number;
  readonly deviceType: string;
  readonly backend: string;
  readonly driver: string;
  readonly driverInfo: string;
  readonly nvidia: boolean;
}

export interface CudaDevice {
  readonly ordinal: number;
  readonly name: string;
  readonly computeCapability: string;
  readonly totalMemory: number;
  readonly multiprocessors: number;
}

export interface GpuReport {
  readonly adapters: readonly GpuAdapter[];
  readonly selected: GpuAdapter | null;
  readonly limits: {
    readonly maxStorageBufferBindingSize: number;
    readonly maxComputeWorkgroupsPerDimension: number;
    readonly maxComputeInvocationsPerWorkgroup: number;
    readonly maxBufferSize: number;
  } | null;
  readonly error: string | null;
  /** `null` when the runtime was built without CUDA. */
  readonly cuda: {
    readonly driverLoaded: boolean;
    readonly nvrtcLoaded: boolean;
    readonly driverVersion: string | null;
    readonly devices: readonly CudaDevice[];
    readonly error: string | null;
  } | null;
}

export interface GpuCallOptions {
  readonly signal?: AbortSignal;
}

export interface WgslJob extends GpuCallOptions {
  /** Must declare `@group(0) @binding(0) var<storage, read_write> data: array<...>;`. */
  readonly shader: string;
  readonly entryPoint?: string;
  readonly workgroups: readonly [number, number, number];
  /** Initial storage buffer; a non-empty multiple of 4 bytes. */
  readonly data: ArrayBufferView;
}

export interface CudaJob extends GpuCallOptions {
  /** `extern "C" __global__ void kernel(float *data, unsigned int n)`, compiled with NVRTC. */
  readonly source: string;
  readonly kernel: string;
  readonly data: Float32Array;
  /** Threads per block, 1..1024; native default 256. */
  readonly blockSize?: number;
}

export interface GpuJobResult<T> {
  readonly data: T;
  readonly elapsedMs: number;
}

const SYMBOLS = {
  yolo_runtime_create: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  yolo_runtime_destroy: { args: [FFIType.u64], returns: FFIType.i32 },
  yolo_gpu_call_start: {
    args: [FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
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
  let message = "native GPU operation failed";
  if (symbols.yolo_last_error(ptr(buffer)) === Status.Ok) {
    try {
      message = (JSON.parse(readBuffer(symbols, buffer)) as { message: string }).message;
    } catch {
      // Preserve the native status if an invalid diagnostic buffer cannot be decoded.
    }
  }
  throw new RuntimeError(status, message);
}

function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Loader of the optional GPU provider of the precompiled runtime. */
export class GpuRuntime implements Disposable {
  readonly #library: Library;
  readonly #handle: bigint;
  readonly #capabilities: readonly string[];
  #closed = false;

  private constructor(library: Library, handle: bigint, capabilities: readonly string[]) {
    this.#library = library;
    this.#handle = handle;
    this.#capabilities = capabilities;
  }

  static load(options: LoadOptions = {}): GpuRuntime {
    const path = options.libraryPath ?? defaultLibraryPath();
    // Negotiate with the core symbols first: an artifact without the GPU feature still loads
    // there, and the GPU symbol is only resolved once its capability is advertised.
    let capabilities: readonly string[];
    {
      using probe = Runtime.load(options);
      capabilities = probe.capabilities();
    }
    const missing = GPU_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
    if (missing.length > 0) {
      throw new RuntimeError(
        Status.AbiMismatch,
        "the precompiled runtime does not provide GPU capabilities; install a GPU-enabled release",
      );
    }
    const library = dlopen(path, SYMBOLS);
    const createInfo = new Uint32Array([
      16,
      EXPECTED_ABI_MAJOR,
      GPU_ABI_MINOR,
      options.maxOperations ?? 8,
    ]);
    const out = new BigUint64Array(1);
    try {
      check(library.symbols, library.symbols.yolo_runtime_create(ptr(createInfo), ptr(out)));
      return new GpuRuntime(library, out[0] as bigint, capabilities);
    } catch (error) {
      library.close();
      throw error;
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** True when this artifact was built with CUDA (the driver may still be absent; see `info`). */
  get hasCuda(): boolean {
    return this.#capabilities.includes(CUDA_CAPABILITY);
  }

  info(options?: GpuCallOptions): Promise<GpuReport> {
    return this.#call<GpuReport>({ op: "info" }, undefined, options);
  }

  async wgsl(job: WgslJob): Promise<GpuJobResult<Uint8Array>> {
    const result = await this.#call<{ data: string; elapsedMs: number }>(
      {
        op: "wgsl",
        shader: job.shader,
        entryPoint: job.entryPoint ?? "main",
        workgroups: job.workgroups,
      },
      bytesOf(job.data),
      job,
    );
    return {
      data: new Uint8Array(Buffer.from(result.data, "base64")),
      elapsedMs: result.elapsedMs,
    };
  }

  async cuda(job: CudaJob): Promise<GpuJobResult<Float32Array>> {
    if (!this.hasCuda) {
      throw new RuntimeError(Status.AbiMismatch, "this runtime was built without gpu.cuda");
    }
    const result = await this.#call<{ data: string; elapsedMs: number }>(
      { op: "cuda", source: job.source, kernel: job.kernel, blockSize: job.blockSize ?? 0 },
      bytesOf(job.data),
      job,
    );
    const bytes = Buffer.from(result.data, "base64");
    // Copy into an aligned buffer: base64 decoding does not guarantee 4-byte alignment.
    const values = new Float32Array(bytes.byteLength / 4);
    new Uint8Array(values.buffer).set(bytes);
    return { data: values, elapsedMs: result.elapsedMs };
  }

  async #call<T>(command: unknown, data?: Uint8Array, options: GpuCallOptions = {}): Promise<T> {
    if (this.#closed) throw new RuntimeError(Status.InvalidHandle, "GPU runtime is closed");
    options.signal?.throwIfAborted();
    const json = new TextEncoder().encode(JSON.stringify(command));
    if (json.length === 0 || json.length > MAX_COMMAND_BYTES) {
      throw new RangeError("GPU command must contain 1 byte..1 MiB");
    }
    if (data !== undefined && data.byteLength > MAX_GPU_DATA_BYTES) {
      throw new RangeError("GPU data must be at most 16 MiB");
    }
    const symbols = this.#library.symbols;
    const out = new BigUint64Array(1);
    const hasData = data !== undefined && data.byteLength > 0;
    check(
      symbols,
      symbols.yolo_gpu_call_start(
        this.#handle,
        ptr(json),
        json.length,
        hasData ? ptr(data) : null,
        hasData ? data.byteLength : 0,
        ptr(out),
      ),
    );
    const operation = out[0] as bigint;
    const cancel = (): void => {
      if (!this.#closed) symbols.yolo_operation_cancel(operation);
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        if (this.#closed) throw new RuntimeError(Status.InvalidHandle, "GPU runtime is closed");
        const buffer = new Uint8Array(24);
        const status = symbols.yolo_operation_wait(operation, 0, ptr(buffer));
        if (status !== Status.Timeout) {
          const raw = status === Status.Ok ? readBuffer(symbols, buffer) : undefined;
          options.signal?.throwIfAborted();
          check(symbols, status);
          return JSON.parse(raw as string) as T;
        }
        // oxlint-disable-next-line no-await-in-loop -- sequential polling of one native operation
        await Bun.sleep(1);
      }
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      if (!this.#closed) check(symbols, symbols.yolo_operation_release(operation));
    }
  }

  close(): void {
    if (this.#closed) return;
    check(this.#library.symbols, this.#library.symbols.yolo_runtime_destroy(this.#handle));
    this.#closed = true;
    this.#library.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
