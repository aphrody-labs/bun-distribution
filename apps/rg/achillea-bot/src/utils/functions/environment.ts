import { cleanEnv, num, str } from "envalid";

import { env } from "@/env";
import { apiConfig, generalConfig, mikroORMConfig } from "@/configs";

export function checkEnvironmentVariables() {
	const config = mikroORMConfig[env.NODE_ENV];

	const isSqliteDatabase =
		config.hasOwnProperty("dbName") && config.dbName !== "" && !config.hasOwnProperty("port");
	const databaseUrl =
		env.NODE_ENV === "test"
			? (env.TEST_DATABASE_URL ?? env.DATABASE_URL_DEV ?? env.DATABASE_URL)
			: env.NODE_ENV === "development"
				? (env.DATABASE_URL_DEV ?? env.DATABASE_URL)
				: env.DATABASE_URL;
	if (!isSqliteDatabase && !databaseUrl) {
		cleanEnv(process.env, {
			DATABASE_HOST: str({ default: env.DATABASE_HOST_DEV }),
			DATABASE_PORT: num({ default: Number(env.DATABASE_PORT_DEV) }),
			DATABASE_NAME: str({ default: env.DATABASE_NAME_DEV }),
			DATABASE_USER: str({ default: env.DATABASE_USER_DEV }),
			DATABASE_PASSWORD: str({ default: env.DATABASE_PASSWORD_DEV }),
		});
	}

	if (apiConfig.enabled === true) {
		cleanEnv(process.env, {
			API_PORT: num({ default: env.API_PORT }),
			API_ADMIN_TOKEN: str(),
		});
	}

	if (generalConfig.automaticUploadImagesToImgur === true) {
		cleanEnv(process.env, {
			IMGUR_CLIENT_ID: str(),
		});
	}
}
