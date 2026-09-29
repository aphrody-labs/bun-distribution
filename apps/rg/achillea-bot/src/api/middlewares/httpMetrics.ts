import type { PlatformContext } from "@tsed/common";
import { Context, Middleware } from "@tsed/common";

import { MetricsService } from "@/services/MetricsService";
import { resolveDependency } from "@/utils/functions";

@Middleware()
export class HttpMetricsMiddleware {
	private metrics: MetricsService | null = null;

	constructor() {
		resolveDependency(MetricsService)
			.then((m) => {
				this.metrics = m;
			})
			.catch(() => {
				/* metrics not wired, silently skip */
			});
	}

	use(@Context() ctx: PlatformContext) {
		const start = Date.now();
		const method = ctx.request.method;
		const route = (ctx.request as unknown as { path?: string }).path ?? ctx.request.url ?? "/";

		ctx.response.onEnd(() => {
			if (!this.metrics) return;
			const durationSec = (Date.now() - start) / 1000;
			const status = String(ctx.response.statusCode ?? 200);
			const normalizedRoute = route.split("?")[0] ?? "/";

			this.metrics.increment("achillea_http_requests_total", {
				method,
				route: normalizedRoute,
				status,
			});
			this.metrics.observe("achillea_http_request_duration_seconds", durationSec, {
				method,
				route: normalizedRoute,
			});
		});
	}
}
