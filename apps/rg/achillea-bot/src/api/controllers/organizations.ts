import { BodyParams, Controller, Get, PathParams, Post, QueryParams, Req, Res } from "@tsed/common";
import type { Request, Response } from "express";

import { urlsConfig } from "@/configs";
import { BaseController } from "@/utils/classes";

/** Legacy `/organizations` surface: transport compatibility only. */
@Controller("/organizations")
export class OrganizationsController extends BaseController {
	constructor() { super(); }

	@Get("/")
	async list(@QueryParams("page") page = 1, @QueryParams("pagination") pagination = 25, @QueryParams("state") state = 1, @Req() req: Request, @Res() res: Response) {
		return this.forward(`/organizations?page=${Number(page) || 1}&pageSize=${Number(pagination) || 25}&state=${Number(state)}`, req, res);
	}

	@Get("/me")
	async mine(@Req() req: Request, @Res() res: Response) { return this.forward("/organizations/me", req, res); }

	@Post("/create")
	async create(@BodyParams() body: unknown, @Req() req: Request, @Res() res: Response) { return this.forward("/organizations/create", req, res, "POST", body); }

	@Post("/validate")
	async validate(@BodyParams() body: unknown, @Req() req: Request, @Res() res: Response) { return this.forward("/organizations/validate", req, res, "POST", body); }

	@Post("/:id/approve")
	async approve(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) { return this.forward(`/organizations/${id}/approve`, req, res, "POST"); }

	@Post("/:id/reject")
	async reject(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) { return this.forward(`/organizations/${id}/reject`, req, res, "POST"); }

	@Get("/:id")
	async get(@PathParams("id") id: number, @Req() req: Request, @Res() res: Response) { return this.forward(`/organizations/${id}`, req, res); }

	private async forward(path: string, req: Request, res: Response, method = "GET", body?: unknown) {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		if (body !== undefined) headers["content-type"] = "application/json";
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`, {
			method, headers, body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await upstream.text();
		res.status(upstream.status).setHeader("Cache-Control", method === "GET" ? "public, s-maxage=60, stale-while-revalidate=300" : "no-store");
		res.type("application/json");
		return res.send(text);
	}
}
