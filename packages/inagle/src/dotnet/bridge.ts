/**
 * @file bridge.ts
 * @description Unified orchestrator for IECODE .NET & Bun bridge.
 */

import { FallbackDotnetBridge } from "./fallback.js";
import { NativeDotnetBridge } from "./native.js";
import { type IDotnetBridge } from "./types.js";

export interface DotnetBridgeOptions {
  libraryPath?: string;
  preferFallback?: boolean;
}

/**
 * Creates an instance of IDotnetBridge, automatically selecting NativeAOT FFI
 * when available or gracefully falling back to pure TypeScript implementation.
 */
export function createDotnetBridge(options?: DotnetBridgeOptions): IDotnetBridge {
  if (options?.preferFallback) {
    return new FallbackDotnetBridge();
  }

  const native = NativeDotnetBridge.tryLoad(options?.libraryPath);
  if (native) {
    return native;
  }

  return new FallbackDotnetBridge();
}

/** Singleton default bridge instance. */
export const dotnetBridge: IDotnetBridge = createDotnetBridge();
