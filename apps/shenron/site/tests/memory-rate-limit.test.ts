import { describe, expect, test } from "bun:test";
import { createMemoryRateLimiter } from "../src/lib/memory-rate-limit";

describe("createMemoryRateLimiter", () => {
	test("compte atomiquement les lots pondérés", async () => {
		let count = 0;
		const backend = async () => ({
			onclose: null,
			async connect() {},
			async send(_command: string, args: string[]) {
				count += Number(args[3]);
				return [count, 1_000];
			},
		});
		const limiter = createMemoryRateLimiter({ windowMs: 1_000, limit: 5, backend });
		expect((await limiter.consume("visiteur", 4)).limited).toBe(false);
		expect((await limiter.consume("visiteur", 2)).limited).toBe(true);
	});
});
