export interface ServiceHealth {
	status: "ok" | "degraded";
	service: "site" | "bot" | "mcp";
	probe?: "liveness" | "readiness";
	version: string;
	timestamp: string;
	checks: Record<string, "ok" | "unreachable" | "disabled" | `http_${number}`>;
	failureSemantics?: string;
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
		  } = {}
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
