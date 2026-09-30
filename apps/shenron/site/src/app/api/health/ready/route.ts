import { NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import {
	createServiceHealth,
	probeHttp,
	probeDatabase,
	type ServiceHealth,
} from "@/lib/service-health";

export const dynamic = "force-dynamic";

export interface ReadinessDeps {
	probeHttp?: (url: string) => Promise<ServiceHealth["checks"][string]>;
	probeDatabase?: () => Promise<"ok" | "unreachable" | "disabled">;
}

/**
 * Site Readiness Probe (`GET /api/health/ready`)
 *
 * Verifies that the site and its required upstream dependencies (database, bot API)
 * are healthy and ready to serve live user traffic.
 *
 * Failure semantics:
 * - 200 OK: All dependencies are reachable; traffic can be routed to this replica.
 * - 503 Service Unavailable: One or more upstream dependencies are degraded or unreachable.
 *   Load balancers / reverse proxies should temporarily remove this instance from the active
 *   pool without restarting the container, allowing it to recover once backends restore.
 */
export function createReadinessHandler(deps: ReadinessDeps = {}) {
	const checkHttp = deps.probeHttp ?? probeHttp;
	const checkDb = deps.probeDatabase ?? probeDatabase;

	return async function GET(): Promise<NextResponse> {
		const [api, database] = await Promise.all([
			checkHttp(`${API_URL}/api/health/check`),
			checkDb(),
		]);

		const health = createServiceHealth(
			"site",
			process.env.npm_package_version ?? "0.1.0",
			{
				api,
				database,
			},
			{
				probe: "readiness",
				failureSemantics:
					"Readiness probe indicates whether upstream dependencies are ready. A 503 stops ingress traffic without container restart.",
			}
		);

		return NextResponse.json(health, {
			status: health.status === "ok" ? 200 : 503,
			headers: { "cache-control": "no-store" },
		});
	};
}

export const GET = createReadinessHandler();
