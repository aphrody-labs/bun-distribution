import "./setup";
import { describe, expect, it } from "bun:test";
import { resolveBetterAuthSecret } from "../src/lib/better-auth";

const LONG = "x".repeat(32);

describe("resolveBetterAuthSecret", () => {
	it("prefers BETTER_AUTH_SECRET over SESSION_SECRET", () => {
		const r = resolveBetterAuthSecret({
			BETTER_AUTH_SECRET: `a${LONG}`,
			SESSION_SECRET: `b${LONG}`,
			NODE_ENV: "production",
		});
		expect(r).toEqual({ secret: `a${LONG}`, origin: "env" });
	});

	it("falls back to SESSION_SECRET", () => {
		expect(resolveBetterAuthSecret({ SESSION_SECRET: LONG, NODE_ENV: "production" }).secret).toBe(
			LONG
		);
	});

	it("never uses API_ADMIN_TOKEN and fails closed in production", () => {
		expect(() =>
			resolveBetterAuthSecret({ API_ADMIN_TOKEN: LONG, NODE_ENV: "production" })
		).toThrow(/required in production/);
	});

	it("ignores BETTER_AUTH_DEV_SECRET in production", () => {
		expect(() =>
			resolveBetterAuthSecret({ BETTER_AUTH_DEV_SECRET: "dev", NODE_ENV: "production" })
		).toThrow(/required in production/);
	});

	it("rejects short secrets", () => {
		expect(() => resolveBetterAuthSecret({ BETTER_AUTH_SECRET: "short" })).toThrow(/32/);
	});

	it("accepts an explicit dev secret outside production", () => {
		expect(resolveBetterAuthSecret({ BETTER_AUTH_DEV_SECRET: "dev", NODE_ENV: "test" })).toEqual({
			secret: "dev",
			origin: "dev",
		});
	});

	it("uses a random ephemeral secret outside production when nothing is set", () => {
		const r = resolveBetterAuthSecret({ NODE_ENV: "development" }, () => "rand");
		expect(r).toEqual({ secret: "rand", origin: "ephemeral" });
		const a = resolveBetterAuthSecret({});
		const b = resolveBetterAuthSecret({});
		expect(a.secret).not.toBe(b.secret);
		expect(a.secret.length).toBeGreaterThanOrEqual(32);
	});
});
