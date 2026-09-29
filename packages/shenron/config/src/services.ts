// SPDX-License-Identifier: Apache-2.0
/**
 * Internal (loopback) service endpoints shared by the bot, the site and the
 * pipeline. Each resolver keeps the historical variable names; the defaults
 * are the local development addresses and the one place in the workspace
 * allowed to spell them. Production values come from the aphrody-infra
 * service catalog through the environment.
 *
 * | service        | read order                      | default                   |
 * | -------------- | ------------------------------- | ------------------------- |
 * | redis/valkey   | `REDIS_URL`, `VALKEY_URL`       | `redis://127.0.0.1:6379`  |
 * | site internal  | `SITE_INTERNAL_URL`             | `http://127.0.0.1:5011`   |
 * | bot API        | `API_HOST` + `API_PORT`         | `http://127.0.0.1:5006`   |
 * | LibreTranslate | `LIBRETRANSLATE_URL`            | `http://127.0.0.1:5000`   |
 * | relecture OCR  | `RELECTURE_OCR_URL`             | `http://127.0.0.1:8791`   |
 *
 * Runtime class: `pure` (takes an explicit env record).
 */
import { type EnvSource, envFirst, envString } from "./env";

export const INTERNAL_SERVICE_ENV = {
	redis: ["REDIS_URL", "VALKEY_URL"],
	siteInternal: ["SITE_INTERNAL_URL"],
	libreTranslate: ["LIBRETRANSLATE_URL"],
	relectureOcr: ["RELECTURE_OCR_URL"],
} as const satisfies Record<string, readonly string[]>;

export const DEFAULT_INTERNAL_SERVICES = {
	redis: "redis://127.0.0.1:6379",
	siteInternal: "http://127.0.0.1:5011",
	botApiHost: "127.0.0.1",
	botApiPort: 5006,
	libreTranslate: "http://127.0.0.1:5000",
	relectureOcr: "http://127.0.0.1:8791",
} as const;

const trimSlash = (u: string): string => u.replace(/\/+$/, "");

/** Redis/Valkey connection URL. */
export function resolveRedisUrl(env: EnvSource): string {
	return envFirst(env, INTERNAL_SERVICE_ENV.redis)?.value ?? DEFAULT_INTERNAL_SERVICES.redis;
}

/** Internal site origin (bot → site calls), without trailing slash. */
export function resolveSiteInternalUrl(env: EnvSource): string {
	return trimSlash(envFirst(env, INTERNAL_SERVICE_ENV.siteInternal)?.value ?? DEFAULT_INTERNAL_SERVICES.siteInternal);
}

/** Internal bot API origin, built from the same `API_HOST`/`API_PORT` as its bind. */
export function resolveBotApiInternalUrl(env: EnvSource): string {
	const host = envString(env, "API_HOST") ?? DEFAULT_INTERNAL_SERVICES.botApiHost;
	const port = envString(env, "API_PORT") ?? String(DEFAULT_INTERNAL_SERVICES.botApiPort);
	return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}

/** LibreTranslate origin, without trailing slash. */
export function resolveLibreTranslateUrl(env: EnvSource): string {
	return trimSlash(envFirst(env, INTERNAL_SERVICE_ENV.libreTranslate)?.value ?? DEFAULT_INTERNAL_SERVICES.libreTranslate);
}

/** Relecture OCR sidecar origin, without trailing slash. */
export function resolveRelectureOcrUrl(env: EnvSource): string {
	return trimSlash(envFirst(env, INTERNAL_SERVICE_ENV.relectureOcr)?.value ?? DEFAULT_INTERNAL_SERVICES.relectureOcr);
}
