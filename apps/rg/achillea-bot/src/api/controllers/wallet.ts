import { Controller, Get, QueryParams, Req, Res } from "@tsed/common";
import type { Request, Response } from "express";

import { urlsConfig } from "@/configs";
import { BaseController } from "@/utils/classes";

/**
 * Compatibility transport: wallet state and transactions are API-owned.
 */
@Controller("/wallet")
export class WalletController extends BaseController {
	constructor() { super(); }

	/** Solde courant du joueur (crée le wallet à la volée si absent). */
	@Get("/me")
	async me(@Req() req: Request, @Res() res: Response) {
		return this.forward("/wallet/me", req, res);
	}

	/** Historique des transactions (du plus récent au plus ancien), avec sens (in/out). */
	@Get("/me/history")
	async history(
		@QueryParams("limit") limit: string,
		@QueryParams("offset") offset: string,
		@Req() req: Request,
		@Res() res: Response
	) {
		const query = new URLSearchParams();
		if (limit) query.set("limit", String(limit));
		if (offset) query.set("offset", String(offset));
		return this.forward(`/wallet/me/history${query.size ? `?${query}` : ""}`, req, res);
	}

	private async forward(path: string, req: Request, res: Response) {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`, { headers });
		const text = await upstream.text();
		res.status(upstream.status).setHeader("Cache-Control", "no-store");
		res.type("application/json");
		return res.send(text);
	}
}
