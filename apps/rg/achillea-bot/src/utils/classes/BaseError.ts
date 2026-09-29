import process from "node:process";

import { Logger } from "../../services/Logger";
import { resolveDependency } from "../functions/dependency";

export abstract class BaseError extends Error {
	protected logger: Logger;

	constructor(message?: string) {
		super(message);
		resolveDependency(Logger).then((logger) => {
			this.logger = logger;
		});
	}

	handle() {}

	kill() {
		process.exit(1);
	}
}
