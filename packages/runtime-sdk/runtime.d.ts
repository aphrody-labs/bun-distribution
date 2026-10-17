declare module "runtime:system" {
  export const system: {
    stats(): { os: string; arch: string; timestamp_ms: number };
    bench(iterations: number, options?: { signal?: AbortSignal }): Promise<{ message: string; latency_us: number }>;
    info(): {
      name: string;
      version: string;
      abi: string;
      target: string;
      rustc: string;
      git_rev: string;
      panic_recovery: boolean;
    };
    capabilities(): string[];
  };
}

declare module "runtime:process" {
  import type { ManagedProcess, SpawnOptions } from "@aphrody/runtime-sdk";
  export const processes: {
    spawn(options: SpawnOptions): ManagedProcess;
    probeHttp(host: string, port: number, path?: string, timeoutMs?: number): Promise<number | undefined>;
  };
}

// Desktop and browser APIs require separately qualified native providers.
declare module "runtime:desktop" {
  import type { DesktopOptions, DesktopSession } from "@aphrody/runtime-sdk/desktop";
  export const desktop: {
    open(options: DesktopOptions): Promise<DesktopSession>;
  };
}
declare module "runtime:browser" {
  import type { LoadOptions } from "@aphrody/runtime-sdk";
  import { BrowserRuntime } from "@aphrody/runtime-sdk/browser";
  export { BrowserRuntime };
  export type {
    BrowserContext,
    BrowserContextOptions,
    BrowserCallOptions,
    BrowserSnapshot,
    BrowserNavigation,
    BrowserWaitUntil,
  } from "@aphrody/runtime-sdk/browser";
  export const browser: {
    load(options?: LoadOptions): BrowserRuntime;
  };
}
