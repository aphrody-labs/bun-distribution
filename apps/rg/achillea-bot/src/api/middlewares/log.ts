import type { PlatformContext } from "@tsed/common";
import { Context, Middleware } from "@tsed/common";
import chalk from "chalk";

import { Logger } from "@/services";
import { resolveDependency } from "@/utils/functions";
import { safeRequestPath } from "../security/request-log";

@Middleware()
export class Log {
	private readonly loggerPromise = resolveDependency(Logger);

	async use(@Context() { request }: PlatformContext) {
		const logger = await this.loggerPromise;
		const { method } = request;
		const target = safeRequestPath(request.url);
		const message = `(API) ${method} - ${target}`;
		const chalkedMessage = `(${chalk.bold.white("API")}) ${chalk.bold.green(method)} - ${chalk.bold.blue(target)}`;

		logger.console(chalkedMessage);
		logger.file(message);
	}
}
