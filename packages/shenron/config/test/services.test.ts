// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	resolveBotApiInternalUrl,
	resolveLibreTranslateUrl,
	resolveRedisUrl,
	resolveRelectureOcrUrl,
	resolveSiteInternalUrl,
} from "../src/services";

describe("internal service resolvers", () => {
	test("defaults", () => {
		expect(resolveRedisUrl({})).toBe("redis://127.0.0.1:6379");
		expect(resolveSiteInternalUrl({})).toBe("http://127.0.0.1:5011");
		expect(resolveBotApiInternalUrl({})).toBe("http://127.0.0.1:5006");
		expect(resolveLibreTranslateUrl({})).toBe("http://127.0.0.1:5000");
		expect(resolveRelectureOcrUrl({})).toBe("http://127.0.0.1:8791");
	});
	test("historical names and order", () => {
		expect(resolveRedisUrl({ VALKEY_URL: "redis://v:1" })).toBe("redis://v:1");
		expect(resolveRedisUrl({ REDIS_URL: "redis://r:1", VALKEY_URL: "redis://v:1" })).toBe("redis://r:1");
		expect(resolveRedisUrl({ REDIS_URL: " ", VALKEY_URL: "redis://v:1" })).toBe("redis://v:1");
		expect(resolveSiteInternalUrl({ SITE_INTERNAL_URL: "http://s:1/" })).toBe("http://s:1");
		expect(resolveBotApiInternalUrl({ API_HOST: "0.0.0.0", API_PORT: "7000" })).toBe("http://0.0.0.0:7000");
		expect(resolveBotApiInternalUrl({ API_HOST: "::1" })).toBe("http://[::1]:5006");
	});
});
