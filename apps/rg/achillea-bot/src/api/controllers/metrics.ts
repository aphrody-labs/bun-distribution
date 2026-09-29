import { Controller, Get, Res } from "@tsed/common";
import type { Response } from "express";

import { MetricsService } from "@/services/MetricsService";
import { BaseController } from "@/utils/classes";
import { resolveDependenciesSync } from "@/utils/functions";

@Controller("/metrics")
export class MetricsController extends BaseController {
	private metricsService: MetricsService;

	constructor() {
		super();
		[this.metricsService] = resolveDependenciesSync([MetricsService]);
	}

	@Get("/")
	async getMetrics(@Res() res: Response) {
		const body = await this.metricsService.render();
		res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
		res.status(200).send(body);
	}
}
