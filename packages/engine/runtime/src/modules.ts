/**
 * Public module surface of the runtime: `runtime:system` (capabilities `system.stats` and
 * `bench.compute`). Desktop uses a separately installed native system-WebView host; browser
 * operations require an optional browser-enabled artifact with negotiated capabilities.
 *
 * One shared runtime instance per process, created lazily and closed at exit.
 */
import { BrowserRuntime } from "./browser";
export { BrowserRuntime } from "./browser";
export { desktop } from "./desktop";
import {
  Runtime,
  type LoadOptions,
  type BenchmarkResult,
  type BuildInfo,
  type ManagedProcess,
  type SpawnOptions,
  type SystemStats,
} from "./index";

let shared: Runtime | undefined;

export function sharedRuntime(): Runtime {
  if (shared === undefined) {
    // Process handles and readiness probes share this bounded pool. Four slots cannot
    // supervise three engines while their readiness work is concurrent.
    shared = Runtime.load({ maxOperations: 32 });
    process.once("exit", () => closeSharedRuntime());
  }
  return shared;
}

export function closeSharedRuntime(): void {
  shared?.close();
  shared = undefined;
}

export const system = {
  /** Operating system, architecture and timestamp. */
  stats(): SystemStats {
    return sharedRuntime().systemStats();
  },
  /** Cancellable benchmark; pass an `AbortSignal` to cancel it natively. */
  bench(iterations: number, options?: { signal?: AbortSignal }): Promise<BenchmarkResult> {
    return sharedRuntime().benchmark(iterations, options);
  },
  /** Build identity and ABI of the loaded runtime artifact. */
  info(): BuildInfo {
    return sharedRuntime().buildInfo();
  },
  capabilities(): string[] {
    return sharedRuntime().capabilities();
  },
};

/** `runtime:process`: capabilities `process.supervise` and `http.probe`. */
export const processes = {
  /** Spawns a child in its own process group; the runtime stops it at exit if still alive. */
  spawn(options: SpawnOptions): ManagedProcess {
    return sharedRuntime().spawn(options);
  },
  /** One HTTP GET on a native worker: the status code, or `undefined` when nothing answers (yet). */
  probeHttp(host: string, port: number, path = "/", timeoutMs = 500): Promise<number | undefined> {
    return sharedRuntime().probeHttp(host, port, path, timeoutMs);
  },
};

/** Browser extension symbols bind only after native capability negotiation. */
export const browser = {
  load(options?: LoadOptions): BrowserRuntime {
    return BrowserRuntime.load(options);
  },
};
