/** Public module surface of the runtime. */
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
  stats(): SystemStats {
    return sharedRuntime().systemStats();
  },
  bench(iterations: number, options?: { signal?: AbortSignal }): Promise<BenchmarkResult> {
    return sharedRuntime().benchmark(iterations, options);
  },
  info(): BuildInfo {
    return sharedRuntime().buildInfo();
  },
  capabilities(): string[] {
    return sharedRuntime().capabilities();
  },
};
export const processes = {
  spawn(options: SpawnOptions): ManagedProcess {
    return sharedRuntime().spawn(options);
  },
  probeHttp(host: string, port: number, path = "/", timeoutMs = 500): Promise<number | undefined> {
    return sharedRuntime().probeHttp(host, port, path, timeoutMs);
  },
};
export const browser = {
  load(options?: LoadOptions): BrowserRuntime {
    return BrowserRuntime.load(options);
  },
};
