export interface ServiceHealth {
	status: "ok" | "degraded";
	service: "site" | "bot" | "mcp";
	version: string;
	timestamp: string;
	checks: Record<string, "ok" | "unreachable" | `http_${number}`>;
}

type HealthFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function probeHttp(
	url: string,
	fetcher: HealthFetcher = fetch
): Promise<ServiceHealth["checks"][string]> {
	try {
		const response = await fetcher(url, { signal: AbortSignal.timeout(2_500) });
		return response.ok ? "ok" : `http_${response.status}`;
	} catch {
		return "unreachable";
	}
}

export function createServiceHealth(
	service: ServiceHealth["service"],
	version: string,
	checks: ServiceHealth["checks"],
	now = new Date()
): ServiceHealth {
	return {
		status: Object.values(checks).every((check) => check === "ok") ? "ok" : "degraded",
		service,
		version,
		timestamp: now.toISOString(),
		checks,
	};
}
