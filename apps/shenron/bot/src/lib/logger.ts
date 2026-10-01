import { isCompiledBinary } from "@aphrody/discord-kit";
import pino from "pino";
import { env } from "./env";

export const logger = pino({
	level: env.LOG_LEVEL,
	base: { app: "shenron" },
	transport:
		env.NODE_ENV === "development" && !isCompiledBinary()
			? {
					target: "pino-pretty",
					options: { colorize: true, singleLine: false },
				}
			: undefined,
});

type Logger = typeof logger;
