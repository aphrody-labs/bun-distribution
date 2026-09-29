import "reflect-metadata";

import { DatabaseDriver, defineConfig, Options } from "@mikro-orm/core";

import { mikroORMConfig } from "./src/configs/database";

export default async () => {
	return defineConfig({
		...(mikroORMConfig[Bun.env.NODE_ENV || "development"] as Options<DatabaseDriver>),
		entities: [`src/entities/*.{ts,js}`, `src/plugins/*/entities/*.{ts,js}`],
	});
};
