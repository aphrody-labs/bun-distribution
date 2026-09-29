import { describe, expect, test } from "bun:test";
import { createMemoryRateLimiter } from "@/lib/memory-rate-limit";

function sharedBackend() {
	const counters = new Map<string, number>();
	return {
		onclose: null,
		async connect() {},
		async send(_command: string, args: string[]) {
			await Promise.resolve();
			const key = args[2]!;
			const count = (counters.get(key) ?? 0) + Number(args[3]);
			counters.set(key, count);
			return [count, Number(args[4])];
		},
	};
}

describe("rate limit partagé", () => {
	test("deux instances consomment le même compteur atomique", async () => {
		const client = sharedBackend();
		const backend = async () => client;
		const a = createMemoryRateLimiter({ windowMs: 60_000, limit: 3, namespace: "test", backend });
		const b = createMemoryRateLimiter({ windowMs: 60_000, limit: 3, namespace: "test", backend });
		const decisions = await Promise.all([
			a.consume("user:ip"),
			b.consume("user:ip"),
			a.consume("user:ip"),
			b.consume("user:ip"),
		]);
		expect(decisions.filter((value) => value.limited)).toHaveLength(1);
		expect(decisions.at(-1)?.retryAfter).toBe(60);
	});

	test("refuse l'écriture et publie Retry-After si Redis tombe", async () => {
		const limiter = createMemoryRateLimiter({
			windowMs: 10_000,
			limit: 1,
			backend: async () => {
				throw new Error("offline");
			},
		});
		const decision = await limiter.consume("visitor");
		expect(decision).toEqual({
			limited: true,
			retryAfter: 10,
			remaining: 0,
			backend: "unavailable",
		});
	});
});
