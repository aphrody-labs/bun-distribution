import { BodyParams, Controller, Delete, Get, PathParams, Post, Put, Req, Res } from "@tsed/common";
import type { Request, Response } from "express";

import { urlsConfig } from "@/configs";
import { BaseController } from "@/utils/classes";

/** Compatibility transport; player-note state and authorization live in rg-api. */
@Controller("/player-notes")
export class PlayerNotesController extends BaseController {
	private async forward(req: Request, res: Response, path: string, method = req.method, body?: unknown) {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		if (body !== undefined) headers["content-type"] = "application/json";
		const upstream = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const text = await upstream.text();
		res.status(upstream.status).type("json");
		return res.send(text);
	}

	@Get("/")
	async list(@Req() req: Request, @Res() res: Response) {
		// Express may expose the full mounted path in req.url. Only forward its
		// query string; appending the path produced /player-notes/api/player-notes.
		const search = new URL(req.originalUrl, "http://localhost").search;
		return this.forward(req, res, `/player-notes${search}`);
	}

	@Get("/summary/:userId")
	async summary(@PathParams("userId") userId: string, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, `/player-notes/summary/${encodeURIComponent(userId)}`);
	}

	@Post("/")
	async create(@BodyParams() body: unknown, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, "/player-notes", "POST", body);
	}

	@Put("/:id")
	async update(@PathParams("id") id: string, @BodyParams() body: unknown, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, `/player-notes/${encodeURIComponent(id)}`, "PUT", body);
	}

	@Post("/:id/resolve")
	async resolve(@PathParams("id") id: string, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, `/player-notes/${encodeURIComponent(id)}/resolve`, "POST");
	}

	@Post("/:id/reopen")
	async reopen(@PathParams("id") id: string, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, `/player-notes/${encodeURIComponent(id)}/reopen`, "POST");
	}

	@Delete("/:id")
	async remove(@PathParams("id") id: string, @Req() req: Request, @Res() res: Response) {
		return this.forward(req, res, `/player-notes/${encodeURIComponent(id)}`, "DELETE");
	}
}
