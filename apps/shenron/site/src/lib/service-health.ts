import type { EnvSource } from "@shenron/db/config";

export interface ServiceHealth {
  status: "ok" | "degraded";
  service: "site" | "bot" | "mcp";
  probe?: "liveness" | "readiness";
  version: string;
  timestamp: string;
  checks: Record<
    string,
    "ok" | "unreachable" | "disabled" | "not_configured" | "empty" | `http_${number}`
  >;
  failureSemantics?: string;
}

type HealthFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function probeHttp(
  url: string,
  fetcher: HealthFetcher = fetch,
): Promise<ServiceHealth["checks"][string]> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(2_500) });
    return response.ok ? "ok" : `http_${response.status}`;
  } catch {
    return "unreachable";
  }
}

export async function probeDatabase(): Promise<"ok" | "unreachable" | "disabled"> {
  try {
    const { resolveDatabaseUrl, db } = await import("@/lib/db");
    if (!resolveDatabaseUrl(process.env.DATABASE_URL)) {
      return "disabled";
    }
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    return "ok";
  } catch {
    return "unreachable";
  }
}

/** Database is mandatory when the native RAG backend is selected or explicitly required. */
export function databaseRequired(
  env: EnvSource = process.env,
): boolean {
  return env.RAG_BACKEND === "aphrody" || env.SITE_REQUIRE_DATABASE === "1";
}

/** `disabled` only passes readiness when the database is optional. */
export function enforceDatabaseRequirement(
  state: "ok" | "unreachable" | "disabled",
  required: boolean,
): ServiceHealth["checks"][string] {
  return state === "disabled" && required ? "not_configured" : state;
}

const RAG_PROBE_QUERY = "Son Goku";
const RAG_PROBE_TIMEOUT_MS = 5_000;
const RAG_PROBE_OK_TTL_MS = 15_000;
let ragOkUntil = 0;

export interface RagSearchProbe {
  (query: string, limit: number, signal?: AbortSignal): Promise<{ results: unknown[] }>;
}

let ragInFlight: Promise<ServiceHealth["checks"][string]> | undefined;

/**
 * Runtime availability of native retrieval; full corpus qualification is separate.
 * Concurrent probes share one search, requests are cancelled after five seconds,
 * and successful checks last fifteen seconds. Empty or malformed hits fail.
 */
export async function probeRag(
  env: EnvSource = process.env,
  search?: RagSearchProbe,
  now: () => number = Date.now,
): Promise<ServiceHealth["checks"][string]> {
  if (env.RAG_BACKEND !== "aphrody") return "disabled";
  if (!search && now() < ragOkUntil) return "ok";
  if (!search && ragInFlight) return ragInFlight;
  const check = (async (): Promise<ServiceHealth["checks"][string]> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const run =
        search ??
        (async (q, limit) => {
          const [{ searchAphrodyRag }, { AphrodyComputeClient }] = await Promise.all([
            import("@/lib/site-rag"),
            import("@shenron/pipeline/aphrody/compute"),
          ]);
          const fetcher = ((input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, controller.signal])
                : controller.signal,
            })) as typeof fetch;
          return searchAphrodyRag(q, limit, {}, new AphrodyComputeClient({ fetcher }));
        });
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, RAG_PROBE_TIMEOUT_MS);
        timer.unref?.();
      });
      const out = await Promise.race([run(RAG_PROBE_QUERY, 1, controller.signal), deadline]);
      const results = (out as { results?: unknown; error?: unknown } | null)?.results;
      if ((out as { error?: unknown } | null)?.error || !Array.isArray(results))
        return "unreachable";
      if (results.length === 0) return "empty";
      if (
        !results.every((hit: unknown) => {
          if (!hit || typeof hit !== "object") return false;
          const item = hit as { content?: unknown; snippet?: unknown };
          return (
            (typeof item.content === "string" && item.content.trim().length > 0) ||
            (typeof item.snippet === "string" && item.snippet.trim().length > 0)
          );
        })
      )
        return "unreachable";
      if (!search) ragOkUntil = now() + RAG_PROBE_OK_TTL_MS;
      return "ok";
    } catch (error) {
      ragOkUntil = 0;
      const http = /HTTP (\d{3})/.exec(error instanceof Error ? error.message : "");
      return http ? (`http_${Number(http[1])}` as const) : "unreachable";
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  })();
  if (search) return check;
  ragInFlight = check;
  try {
    return await check;
  } finally {
    if (ragInFlight === check) ragInFlight = undefined;
  }
}

export function resetRagProbeCache(): void {
  ragOkUntil = 0;
}

export function createServiceHealth(
  service: ServiceHealth["service"],
  version: string,
  checks: ServiceHealth["checks"],
  optionsOrNow:
    | Date
    | {
        probe?: "liveness" | "readiness";
        now?: Date;
        failureSemantics?: string;
      } = {},
): ServiceHealth {
  const options = optionsOrNow instanceof Date ? { now: optionsOrNow } : optionsOrNow;
  const isOk = Object.values(checks).every((check) => check === "ok" || check === "disabled");
  return {
    status: isOk ? "ok" : "degraded",
    service,
    ...(options.probe ? { probe: options.probe } : {}),
    version,
    timestamp: (options.now ?? new Date()).toISOString(),
    checks,
    ...(options.failureSemantics ? { failureSemantics: options.failureSemantics } : {}),
  };
}
