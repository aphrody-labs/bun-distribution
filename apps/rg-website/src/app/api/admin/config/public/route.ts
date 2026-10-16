import { NextResponse } from "next/server";
import { createPostgresClient } from "@rosegriffon/db/service";

import { requireApiAdmin } from "@/lib/api-auth";
import { ADMIN_PUBLIC_SETTINGS } from "@/lib/admin-settings-contract";

export const dynamic = "force-dynamic";

/** Contract-backed public settings only; other DB settings are never returned. */
export async function GET() {
	const guard = await requireApiAdmin();
	if (!guard.ok) return guard.response;
	const keys = Object.keys(ADMIN_PUBLIC_SETTINGS);
	const { data, error } = await createPostgresClient()
		.from("settings")
		.select("key,value,updated_at")
		.in("key", keys);
	if (error) return NextResponse.json({ error: "Lecture de configuration indisponible" }, { status: 503 });
	const current = new Map<string, { key: string; value: unknown; updated_at: string }>(
		(data ?? []).map((row: { key: string; value: unknown; updated_at: string }) => [row.key, row])
	);
	return NextResponse.json({
		settings: Object.entries(ADMIN_PUBLIC_SETTINGS).map(([key, contract]) => ({
			key,
			...contract,
			value: current.get(key)?.value ?? null,
			updatedAt: current.get(key)?.updated_at ?? null,
		})),
	}, { headers: { "cache-control": "private, no-store" } });
}
