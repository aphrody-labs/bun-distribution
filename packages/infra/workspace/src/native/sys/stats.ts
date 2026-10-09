/**
 * System hardware, architecture and runtime metrics.
 */
import { cpus, freemem, totalmem, uptime } from "node:os";

export interface SystemStats {
  readonly os: string;
  readonly arch: string;
  readonly timestamp_ms: number;
  readonly uptimeSeconds?: number | undefined;
  readonly totalMemoryBytes?: number | undefined;
  readonly freeMemoryBytes?: number | undefined;
  readonly cpuCores?: number | undefined;
}

export function getSystemStats(): SystemStats {
  return {
    os: process.platform,
    arch: process.arch,
    timestamp_ms: Date.now(),
    uptimeSeconds: Math.floor(uptime()),
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    cpuCores: cpus().length,
  };
}
