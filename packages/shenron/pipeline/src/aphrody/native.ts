// SPDX-License-Identifier: Apache-2.0
/** Shenron result adapters over the one @aphrody/bun native library owner. */
import {
  EXPECTED_SHENRON_ABI_VERSION,
  shenronAbiVersion,
  shenronVersion,
  shenronRunCaptured,
  shenronRagSearch,
  shenronRagStats,
  shenronAuthStatus,
  shenronPersonaPrompt,
} from "@aphrody/bun/shenron";
import type { AphrodyDoctorResult, CliResult } from "./cli";
import type { AphrodyRagHit, AphrodyRagStats } from "./compute";

export const EXPECTED_ABI_VERSION = EXPECTED_SHENRON_ABI_VERSION;
export interface ShenronAuthStatus {
  configured: boolean;
  adminCredentialsPresent: boolean;
}
function nativeValue<T>(operation: () => T): T | null {
  try {
    return operation();
  } catch {
    return null;
  }
}
/** Check the shared owner on demand; transient failures are not cached here. */
export function isNativeAvailable(): boolean {
  return nativeAbiVersion() !== null;
}
export function nativeAbiVersion(): number | null {
  return nativeValue(shenronAbiVersion);
}
export function nativeVersion(): string | null {
  return nativeValue(shenronVersion);
}
export function runCapturedNative(
  args: readonly string[],
): { code: number; stdout: string; stderr: string } | null {
  return nativeValue(() => shenronRunCaptured([...args]));
}

/**
 * High-level native client exposing in-process Aphrody operations.
 */
export class AphrodyNativeClient {
  get isAvailable(): boolean {
    return isNativeAvailable();
  }

  /** Run a command and return classified CliResult. */
  async run<T = unknown>(args: readonly string[]): Promise<CliResult<T>> {
    const t0 = performance.now();
    const captured = runCapturedNative(args);
    const durationMs = Math.round(performance.now() - t0);

    if (!captured) {
      return {
        kind: "not_found",
        bin: "aphrody_ffi",
        message: "Native FFI library not available on this platform",
      };
    }

    if (captured.code === 0) {
      try {
        const data = JSON.parse(captured.stdout.trim()) as T;
        return {
          kind: "exit",
          ok: true,
          code: 0,
          data,
          stdout: captured.stdout,
          stderr: captured.stderr,
          durationMs,
        };
      } catch {
        return {
          kind: "exit",
          ok: true,
          code: 0,
          data: undefined,
          stdout: captured.stdout,
          stderr: captured.stderr,
          durationMs,
        };
      }
    }

    return {
      kind: "exit",
      ok: false,
      code: captured.code,
      stdout: captured.stdout,
      stderr: captured.stderr,
      durationMs,
    };
  }

  /** Fetch doctor diagnostics through the Shenron-scoped ABI (which adds its namespace). */
  async doctor(): Promise<AphrodyDoctorResult | null> {
    const res = await this.run<AphrodyDoctorResult>(["doctor", "--json"]);
    return res.kind === "exit" && res.ok ? (res.data ?? null) : null;
  }

  /** Query the canonical Shenron RAG bridge. */
  async ragSearch(
    query: string,
    options: { limit?: number; kind?: string } = {},
  ): Promise<AphrodyRagHit[]> {
    const envelope = nativeValue(() =>
      shenronRagSearch(
        query,
        Math.trunc(Math.max(1, Math.min(options.limit ?? 5, 100))),
        options.kind || undefined,
      ),
    );
    if (!envelope) return [];
    try {
      if (envelope.code !== 0 || typeof envelope.stdout !== "string") return [];
      const rows = JSON.parse(envelope.stdout.trim());
      if (!Array.isArray(rows)) return [];
      const ranked = rows.map((row: any) => ({
        title: row.title || "Sans titre",
        url: row.url || "",
        snippet: row.snippet || "",
        score: typeof row.score === "number" ? row.score : 0,
        kind: row.kind || "document",
        sourceId: row.sourceId || undefined,
        lang: row.lang || undefined,
        content: row.content || row.snippet || "",
      }));
      const scores = ranked.map((row: AphrodyRagHit) => row.score);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      return ranked.map((row: AphrodyRagHit) =>
        Object.assign({}, row, {
          score: max > min ? 0.4 + (0.6 * (row.score - min)) / (max - min) : 1,
        }),
      );
    } catch {
      return [];
    }
  }

  /** Fetch RAG index corpus statistics in-process. */
  async ragStats(): Promise<AphrodyRagStats | null> {
    const envelope = nativeValue(shenronRagStats);
    if (!envelope) return null;
    try {
      if (envelope.code !== 0 || typeof envelope.stdout !== "string") return null;
      const data = JSON.parse(envelope.stdout.trim());
      const count = data.total_chunks || 0;
      return {
        chunks: count,
        vectors: 0,
        sources: Array.isArray(data.kinds)
          ? data.kinds.map((k: any) => ({
              sourceId: k.kind || "databook",
              kind: k.kind || "databook",
              count: k.c || 0,
            }))
          : [],
      };
    } catch {
      return null;
    }
  }

  /** Return only the sanitized authentication presence flags. */
  authStatus(): ShenronAuthStatus | null {
    const envelope = nativeValue(shenronAuthStatus);
    if (!envelope) return null;
    try {
      if (envelope.code !== 0 || typeof envelope.stdout !== "string") return null;
      const status = JSON.parse(envelope.stdout.trim());
      if (
        typeof status.configured !== "boolean" ||
        typeof status.admin_credentials_present !== "boolean"
      ) {
        return null;
      }
      return {
        configured: status.configured,
        adminCredentialsPresent: status.admin_credentials_present,
      };
    } catch {
      return null;
    }
  }

  /** Fetch sovereign persona prompt. */
  async personaPrompt(): Promise<string | null> {
    return nativeValue(shenronPersonaPrompt);
  }
}

/** Global singleton instance */
export const aphrodyNative = new AphrodyNativeClient();
