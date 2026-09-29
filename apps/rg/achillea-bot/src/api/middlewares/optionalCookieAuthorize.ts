import { Context, Middleware } from "@tsed/common";
import type { Request } from "express";

import { urlsConfig } from "@/configs";

@Middleware()
export class OptionalAuthMiddleware {
	async use(@Context() ctx: Context) {
		const request = ctx.request as unknown as Request;
		const headers: Record<string, string> = { accept: "application/json" };
		if (request.headers.cookie) headers.cookie = request.headers.cookie;
		if (request.headers.authorization) headers.authorization = request.headers.authorization;
		if (!headers.cookie && !headers.authorization) return;
		try {
			const response = await fetch(`${urlsConfig.unifiedApi}/v1/auth/me`, { headers });
			if (!response.ok) return;
			const body = await response.json() as { user?: unknown };
			if (body.user) ctx.set("user", body.user);
		} catch {
			// Authentication is optional; upstream failures leave the request anonymous.
		}
	}
}
