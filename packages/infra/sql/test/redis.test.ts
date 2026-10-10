// SPDX-License-Identifier: Apache-2.0
// No command is sent: Bun's RedisClient connects on the first command.
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_REDIS_OPTIONS,
	DEFAULT_REDIS_URL,
	createRedisClient,
	redisOptions,
	resolveRedisUrl,
} from "../src/redis";

describe("redis", () => {
	test("URL resolution order and fallback", () => {
		expect(resolveRedisUrl({ env: {} })).toBe(DEFAULT_REDIS_URL);
		expect(resolveRedisUrl({ env: { VALKEY_URL: "redis://v:6379" } })).toBe("redis://v:6379");
		expect(
			resolveRedisUrl({ env: { REDIS_URL: "redis://r:6379", VALKEY_URL: "redis://v:6379" } })
		).toBe("redis://r:6379");
		expect(resolveRedisUrl({ env: { REDIS_URL: "" }, names: ["REDIS_URL"], fallback: "x" })).toBe(
			"x"
		);
		expect(resolveRedisUrl({ env: { VALKEY_URL: "redis://v" }, names: ["REDIS_URL"] })).toBe(
			DEFAULT_REDIS_URL
		);
	});

	test("caller options override the defaults", () => {
		expect(redisOptions()).toEqual({ ...DEFAULT_REDIS_OPTIONS });
		expect(redisOptions({ maxRetries: 3, idleTimeout: 1000 })).toEqual({
			...DEFAULT_REDIS_OPTIONS,
			maxRetries: 3,
			idleTimeout: 1000,
		});
	});

	test("createRedisClient builds a Bun RedisClient lazily", () => {
		const client = createRedisClient("redis://127.0.0.1:1", { autoReconnect: false });
		expect(client).toBeInstanceOf(Bun.RedisClient);
		expect(client.connected).toBe(false);
		client.close();
	});
});
