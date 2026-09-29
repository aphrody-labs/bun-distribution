import { Controller, Get, Res } from "@tsed/common";
import type { Response } from "express";

import { urlsConfig } from "@/configs";
import { BaseController } from "@/utils/classes";

/**
 * Championnats / ligues (format Premier League, distinct des coupes).
 * Asytral League S1 est exposée en lecture seule (données sheet officielles).
 */
@Controller("/leagues")
export class LeaguesController extends BaseController {
	constructor() { super(); }

	/** Liste des championnats connus (MVP : Astral S1). */
	@Get("/")
	async list(@Res() res: Response) {
		return this.proxy("/leagues", res);
	}

	/** Détail Astral League S1 : règlement, classement, résultats, play-offs. */
	@Get("/astral")
	@Get("/astral-s1")
	@Get("/asytral")
	@Get("/asytral-s1")
	async astral(@Res() res: Response) {
		return this.proxy("/leagues/astral", res);
	}

	private async proxy(path: string, res: Response) {
		const response = await fetch(`${urlsConfig.unifiedApi}/v1/achillea${path}`);
		res.status(response.status).setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
		return res.json(await response.json());
	}
}
