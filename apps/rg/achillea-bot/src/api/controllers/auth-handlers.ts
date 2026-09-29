import type { Request, Response } from "express";
import { SESSION_COOKIE_NAME, sessionClearCookieOptions } from "@/auth";

/** Respond to logout without loading the decorated server or other services. */
export function sendLogout(res: Response, secure: boolean): void {
	res.clearCookie(SESSION_COOKIE_NAME, sessionClearCookieOptions(secure));
	res.setHeader("Cache-Control", "no-store");
	res.json({ ok: true });
}

/** Forward the caller's session to the unified realtime token endpoint. */
export async function relayRealtimeToken(
	req: Request,
	res: Response,
	unifiedApi: string,
	fetcher: typeof fetch = fetch
): Promise<Response> {
	const headers: Record<string, string> = { accept: "application/json" };
	if (req.headers.cookie) headers.cookie = req.headers.cookie;
	if (req.headers.authorization) headers.authorization = req.headers.authorization;
	const upstream = await fetcher(`${unifiedApi.replace(/\/+$/u, "")}/v1/auth/realtime-token`, { headers });
	const body = await upstream.text();
	res.status(upstream.status).setHeader("Cache-Control", "no-store");
	res.type("application/json");
	return res.send(body);
}
