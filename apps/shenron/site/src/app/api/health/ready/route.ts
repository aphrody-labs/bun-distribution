import { NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import {
  createServiceHealth,
  probeHttp,
  probeDatabase,
  probeRag,
  databaseRequired,
  enforceDatabaseRequirement,
  type ServiceHealth,
} from "@/lib/service-health";

export const dynamic = "force-dynamic";

export interface ReadinessDeps {
  probeHttp?: (url: string) => Promise<ServiceHealth["checks"][string]>;
  probeDatabase?: () => Promise<"ok" | "unreachable" | "disabled">;
  probeRag?: () => Promise<ServiceHealth["checks"][string]>;
  databaseRequired?: () => boolean;
}

/**
 * Site Readiness Probe (`GET /api/health/ready`)
 *
 * Verifies that the site and its required upstream dependencies (database, bot API)
 * are healthy and ready to serve live user traffic.
 *
 * Failure semantics:
 * - Database `disabled` is ready only when optional (not with RAG_BACKEND=aphrody / SITE_REQUIRE_DATABASE=1).
 * - With RAG_BACKEND=aphrody, a bounded native RAG search must return real hits (availability only).
 * - 200 OK: All dependencies are reachable; traffic can be routed to this replica.
 * - 503 Service Unavailable: One or more upstream dependencies are degraded or unreachable.
 *   Load balancers / reverse proxies should temporarily remove this instance from the active
 *   pool without restarting the container, allowing it to recover once backends restore.
 */
export function createReadinessHandler(deps: ReadinessDeps = {}) {
  const checkHttp = deps.probeHttp ?? probeHttp;
  const checkDb = deps.probeDatabase ?? probeDatabase;
  const checkRag = deps.probeRag ?? (() => probeRag());
  const dbRequired = deps.databaseRequired ?? (() => databaseRequired());

  return async function GET(): Promise<NextResponse> {
    const [api, databaseState, rag] = await Promise.all([
      checkHttp(`${API_URL}/api/health/check`),
      checkDb(),
      checkRag(),
    ]);
    const database = enforceDatabaseRequirement(databaseState, dbRequired());

    const health = createServiceHealth(
      "site",
      process.env.npm_package_version ?? "0.1.0",
      {
        api,
        database,
        ...(rag === "disabled" ? {} : { rag }),
      },
      {
        probe: "readiness",
        failureSemantics:
          "Readiness probe indicates whether upstream dependencies are ready. A 503 stops ingress traffic without container restart.",
      },
    );

    return NextResponse.json(health, {
      status: health.status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  };
}

export const GET = createReadinessHandler();
