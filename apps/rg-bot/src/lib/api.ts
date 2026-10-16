/**
 * Typed client for the website's `/api/bot/v1/*` endpoints.
 * Use this when you want to:
 *  - Benefit from Next.js HTTP-level caching (Cache-Control)
 *  - Centralize audit logging server-side
 *  - Avoid duplicating business logic that already lives in website server actions
 *
 * For tight DB queries, the bot still has direct Bun.SQL access via `lib/db.ts`.
 */

const BASE_URL = Bun.env.WEBSITE_API_URL ?? "https://rosegriffon.fr";
const TOKEN = Bun.env.BOT_API_TOKEN;

export class BotApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body?: unknown
	) {
		super(message);
		this.name = "BotApiError";
	}
}

async function request<T>(
	path: string,
	init: RequestInit & { discordId?: string } = {}
): Promise<T> {
	if (!TOKEN) throw new BotApiError("BOT_API_TOKEN missing", 500);
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${TOKEN}`);
	if (init.discordId) headers.set("x-discord-id", init.discordId);
	if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

	const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
	const text = await res.text();
	let body: unknown;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	if (!res.ok) {
		const msg =
			typeof body === "object" && body && "error" in body
				? String((body as { error: unknown }).error)
				: `HTTP ${res.status}`;
		throw new BotApiError(msg, res.status, body);
	}
	return body as T;
}

export interface ApiProfile {
	id: string;
	username: string | null;
	full_name: string | null;
	email: string | null;
	role: string | null;
	avatar_url: string | null;
	discord_id: string | null;
}

/**
 * A Discord identity that either completed OAuth (`linked`) or was imported
 * from Achillea/RG member data (`linked: false`). Imported identities are
 * display-only: use `apiAuth` for actions requiring an RG account link.
 */
export interface ApiBotIdentity extends Omit<ApiProfile, "email"> {
	linked: boolean;
}

export async function apiAuth(discordId: string): Promise<ApiProfile | null> {
	const data = await request<{ linked: boolean; profile: ApiProfile | null }>(
		`/api/bot/v1/auth?discord_id=${encodeURIComponent(discordId)}`
	);
	return data.profile;
}

export async function apiIdentity(discordId: string): Promise<ApiBotIdentity | null> {
	const data = await request<{ found: boolean; identity: ApiBotIdentity | null }>(
		`/api/bot/v1/identity?discord_id=${encodeURIComponent(discordId)}`
	);
	return data.identity;
}

export interface ApiStats {
	profiles_total: number;
	profiles_24h: number;
	admins: number;
	banned: number;
	articles_published: number;
	articles_draft: number;
	events_upcoming: number;
	events_past: number;
	team_members: number;
	discord_members: number;
	generated_at: string;
}

export async function apiStats(): Promise<ApiStats> {
	return await request<ApiStats>("/api/bot/v1/stats");
}
