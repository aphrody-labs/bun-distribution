import { NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { createServiceHealth, probeHttp } from "@/lib/service-health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
	const api = await probeHttp(`${API_URL}/health`);
	const health = createServiceHealth("site", process.env.npm_package_version ?? "0.1.0", {
		http: "ok",
		api,
	});
	return NextResponse.json(health, {
		status: health.status === "ok" ? 200 : 503,
		headers: { "cache-control": "no-store" },
	});
}
