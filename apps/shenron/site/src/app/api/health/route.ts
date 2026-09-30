import { NextResponse } from "next/server";
import { createServiceHealth } from "@/lib/service-health";

export const dynamic = "force-dynamic";

/**
 * Site Liveness Probe (`GET /api/health` and `GET /api/health/live`)
 *
 * Verifies that the Next.js site process is alive and able to handle HTTP traffic.
 * Does NOT check downstream dependencies (database, bot API, Redis).
 *
 * Failure semantics:
 * - 200 OK: Process is executing normally.
 * - 5xx / No response: Process is dead, frozen, or OOM. Orchestrator (K8s / systemd)
 *   should restart the container.
 */
export async function GET(): Promise<NextResponse> {
	const health = createServiceHealth(
		"site",
		process.env.npm_package_version ?? "0.1.0",
		{ http: "ok" },
		{
			probe: "liveness",
			failureSemantics:
				"Liveness probe indicates if the site process is running and responding. Unresponsive state triggers container restart.",
		}
	);

	return NextResponse.json(health, {
		status: 200,
		headers: { "cache-control": "no-store" },
	});
}
