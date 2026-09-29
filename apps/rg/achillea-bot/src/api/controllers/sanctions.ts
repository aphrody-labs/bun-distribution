import { BodyParams, Controller, Get, PathParams, Post, QueryParams, Req, Res } from "@tsed/common";
import type { Request, Response } from "express";

import { urlsConfig } from "@/configs";
import { BaseController } from "@/utils/classes";

/** Legacy moderation HTTP surface. Persistence and validation are API-owned;
 * this controller only forwards the request while Discord jobs remain local. */
@Controller("/sanctions")
export class SanctionsController extends BaseController {
	constructor() { super(); }

	@Get("/")
	async list(@QueryParams() query: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
		return this.forward(`/sanctions${params.size ? `?${params}` : ""}`, req, res);
	}

	@Post("/")
	async create(@BodyParams() body: unknown, @Req() req: Request, @Res() res: Response) { return this.forward("/sanctions", req, res, "POST", body); }

	@Post("/:id/revoke")
	async revoke(@PathParams("id") id: string, @BodyParams() body: unknown, @Req() req: Request, @Res() res: Response) { return this.forward(`/sanctions/${encodeURIComponent(id)}/revoke`, req, res, "POST", body); }

	@Post("/:id/appeal")
	async appeal(@PathParams("id") id: string, @BodyParams() body: unknown, @Req() req: Request, @Res() res: Response) { return this.forward(`/sanctions/${encodeURIComponent(id)}/appeal`, req, res, "POST", body); }

	private async forward(path: string, req: Request, res: Response, method = "GET", body?: unknown) {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		if (body !== undefined) headers["content-type"] = "application/json";
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
		const text = await upstream.text();
		res.status(upstream.status).setHeader("Cache-Control", method === "GET" ? "no-store" : "no-store");
		res.type("application/json");
		return res.send(text);
	}
}
