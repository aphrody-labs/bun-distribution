import process from "node:process";

import { delay, inject } from "tsyringe";

import { Service } from "@/decorators";
import { Logger } from "./Logger";
import { BaseError } from "@/utils/classes";

@Service()
export class ErrorHandler {
	constructor(@inject(delay(() => Logger)) private logger: any) {
		// Catch all exceptions
		process.on("uncaughtException", (error: Error, origin: string) => {
			// stop in case of unhandledRejection
			if (origin === "unhandledRejection") return;

			// if instance of BaseError, call `handle` method
			if (error instanceof BaseError) return error.handle();

			// log the error
			this.logger.logError(error, "Exception");
		});

		// catch all Unhandled Rejection (promise)
		process.on("unhandledRejection", (error: Error | any, _: Promise<any>) => {
			// if instance of BaseError, call `handle` method
			if (error instanceof BaseError) return error.handle();

			// log the error
			this.logger.logError(error, "unhandledRejection");
		});
	}
}
