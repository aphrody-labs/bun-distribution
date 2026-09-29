import { Context, Controller, Get, Post, Req, Res, UseBefore } from "@tsed/common";
import type { Request, Response } from "express";

import { CookieAuthorize } from "@/api/middlewares";
import { env } from "@/env";
import { urlsConfig } from "@/configs";
import type { UserDTO } from "@/services";
import { BaseController } from "@/utils/classes";
import { relayRealtimeToken, sendLogout } from "./auth-handlers";

function sessionIsSecure(): boolean {
	return new URL(env.OAUTH_CALLBACK_BASE_URL).protocol === "https:";
}

/**
 * Provider OAuth belongs to the unified Elysia API. This controller forwards
 * authenticated provider linking without creating its own OAuth state.
 */
function unifiedProviderStart(provider: "twitch" | "challonge"): string {
	return `${urlsConfig.unifiedApi.replace(/\/+$/u, "")}/v1/auth/oauth/${provider}/start`;
}

@Controller("/auth")
export class AuthController extends BaseController {
	constructor() { super(); }

	@Get("/challonge")
	@UseBefore(CookieAuthorize)
	getChallongeUrl(@Res() res: Response) {
		return res.redirect(unifiedProviderStart("challonge"));
	}

	@Get("/twitch")
	@UseBefore(CookieAuthorize)
	getTwitchUrl(@Res() res: Response) {
		return res.redirect(unifiedProviderStart("twitch"));
	}

	// Authenticated user info endpoint
	@Get("/me")
	@UseBefore(CookieAuthorize)
	async me(@Context() ctx: Context, @Res() res: Response) {
		const user = ctx.get("user") as UserDTO;
		if (user.avatar && !user.avatar.startsWith("http")) {
			user.avatar = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
		}

		res.setHeader("Cache-Control", "no-store");
		return res.json(user);
	}

	@Post("/logout")
	logout(@Res() res: Response) {
		return sendLogout(res, sessionIsSecure());
	}

	// Token endpoint pour Colyseus client (cookie HttpOnly cross-domain WSS)
	@Get("/token")
	@UseBefore(CookieAuthorize)
	async token(@Req() req: Request, @Res() res: Response) {
		return relayRealtimeToken(req, res, urlsConfig.unifiedApi);
	}
}
