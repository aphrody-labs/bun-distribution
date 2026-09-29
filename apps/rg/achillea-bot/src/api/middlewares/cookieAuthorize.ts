import { Context, Middleware } from "@tsed/common";
import { Unauthorized } from "@tsed/exceptions";
import type { Request } from "express";

import { urlsConfig } from "@/configs";

@Middleware()
export class CookieAuthorize {
	async use(@Context() ctx: Context) {
		const request = ctx.request as unknown as Request;
		const headers: Record<string, string> = { accept: "application/json" };
		if (request.headers.cookie) headers.cookie = request.headers.cookie;
		if (request.headers.authorization) headers.authorization = request.headers.authorization;
		const response = await fetch(`${urlsConfig.unifiedApi}/v1/auth/me`, { headers });
		if (!response.ok) throw new Unauthorized("Not authenticated");
		const body = await response.json() as { user?: unknown };
		if (!body.user) throw new Unauthorized("Not authenticated");
		ctx.set("user", body.user);
	}
}
