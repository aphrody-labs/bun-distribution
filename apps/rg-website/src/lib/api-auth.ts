import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isPatreonAdmin } from "@/lib/patreon/admin-access";
import { isAdmin, resolveProfile } from "@rosegriffon/auth";
import { createPostgresClient } from "@rosegriffon/db/service";
import type { RgRole } from "@rosegriffon/types/roles";

type Role = RgRole | null;

export interface ApiAuthSuccess {
	user: { id: string; email: string; name: string };
	role: Role;
}

export type ApiAuthResult =
	| { ok: true; data: ApiAuthSuccess }
	| { ok: false; response: NextResponse };

/**
 * API-route equivalent of `requireAuth()` — returns 401 JSON instead of redirecting.
 */
export async function requireApiAuth(): Promise<ApiAuthResult> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return {
			ok: false,
			response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
		};
	}
	return {
		data: {
			role: null,
			user: {
				email: session.user.email,
				id: session.user.id,
				name: session.user.name,
			},
		},
		ok: true,
	};
}

/**
 * API-route equivalent of `requireAdmin()` — returns 401/403 JSON instead of
 * redirecting. Uses the same 3-strategy resolution (id / discord / email)
 * as the page-level helper.
 */
export async function requireApiAdmin(): Promise<ApiAuthResult> {
	const authed = await requireApiAuth();
	if (!authed.ok) {
		return authed;
	}

	const { user } = authed.data;
	const profile = await resolveProfile(createPostgresClient(), user);
	const role = (profile?.role ?? null) as Role;
	if (!isAdmin(role)) {
		return {
			ok: false,
			response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
		};
	}

	return { data: { role, user }, ok: true };
}

/**
 * API-route equivalent of `requirePatreonCreator()` — restreint l'accès au
 * créateur Patreon principal (`PATREON_CREATOR_EMAIL`) ou à la whitelist
 * Discord définie dans `lib/patreon/admin-access.ts`. Renvoie 401/403 JSON.
 */
export async function requireApiPatreonCreator(): Promise<ApiAuthResult> {
	const authed = await requireApiAuth();
	if (!authed.ok) {
		return authed;
	}
	const allowed = await isPatreonAdmin(authed.data.user);
	if (!allowed) {
		return {
			ok: false,
			response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
		};
	}
	return authed;
}
