import type { PlatformContext } from "@tsed/common";
import { Context, Middleware } from "@tsed/common";

import { randomUUID } from "node:crypto";

@Middleware()
export class CorrelationIdMiddleware {
	use(@Context() ctx: PlatformContext) {
		const id = (ctx.request.get("x-correlation-id") as string | undefined) ?? randomUUID();
		(ctx.request as unknown as Record<string, unknown>)["correlationId"] = id;
		ctx.response.setHeader("X-Correlation-Id", id);
	}
}
