import "./setup";
import { describe, expect, it } from "bun:test";
import { clientIp, createLoginThrottle, isDirectLoopback } from "../src/api/request-guards";
import { adminLogin, publicCachedJson } from "../src/api/server";
import { env } from "../src/lib/env";

function req(headers: Record<string, string> = {}, init: RequestInit = {}, path = "/health") {
	return new Request(`http://localhost${path}`, { headers, ...init });
}

describe("S3 — clientIp", () => {
	it("prefers x-real-ip", () => {
		expect(clientIp(req({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe(
			"9.9.9.9"
		);
	});

	it("uses the LAST XFF hop; a spoofed leftmost hop does not change the key", () => {
		const a = clientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }));
		const b = clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }));
		expect(a).toBe("203.0.113.7");
		expect(b).toBe(a);
		expect(clientIp(req({ "x-forwarded-for": " 203.0.113.8 , " }))).toBe("203.0.113.8");
	});

	it("falls back to unknown", () => {
		expect(clientIp(req())).toBe("unknown");
	});
});

describe("S3 — isDirectLoopback", () => {
	it("loopback socket without proxy headers only", () => {
		expect(isDirectLoopback(req(), "127.0.0.1")).toBe(true);
		expect(isDirectLoopback(req(), "::1")).toBe(true);
		expect(isDirectLoopback(req(), "::ffff:127.0.0.1")).toBe(true);
		expect(isDirectLoopback(req({ "x-real-ip": "8.8.8.8" }), "127.0.0.1")).toBe(false);
		expect(isDirectLoopback(req({ "x-forwarded-for": "8.8.8.8" }), "127.0.0.1")).toBe(false);
		expect(isDirectLoopback(req(), "10.0.0.1")).toBe(false);
		expect(isDirectLoopback(req(), undefined)).toBe(false);
	});
});

describe("S3 — /health rate limit", () => {
	const build = async () => ({ status: "ok" });
	const call = (r: Request, addr?: string) =>
		publicCachedJson(r as Request & { params: Record<string, string> }, 5_000, build, addr);

	it("100 direct-loopback checks are never limited while a proxied caller is", async () => {
		for (let i = 0; i < 100; i++) {
			expect((await call(req(), "127.0.0.1")).status).toBe(200);
		}
		const statuses: number[] = [];
		for (let i = 0; i < 70; i++) {
			statuses.push((await call(req({ "x-real-ip": "198.51.100.9" }), "127.0.0.1")).status);
		}
		expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
		expect(statuses.at(-1)).toBe(429);
	});
});

describe("S4 — login throttle", () => {
	it("11th attempt within the window is refused, window resets", () => {
		let t = 0;
		const throttle = createLoginThrottle({ limit: 10, windowMs: 60_000, now: () => t });
		for (let i = 0; i < 10; i++) expect(throttle.hit("ip").allowed).toBe(true);
		expect(throttle.hit("ip")).toEqual({ allowed: false, retryAfterSeconds: 60 });
		expect(throttle.hit("other").allowed).toBe(true);
		t = 60_000;
		expect(throttle.hit("ip").allowed).toBe(true);
	});

	it("/auth/login returns 429 with Retry-After 60 on the 11th attempt, before token check", async () => {
		const saved = env.API_ADMIN_TOKEN;
		(env as { API_ADMIN_TOKEN?: string }).API_ADMIN_TOKEN = "login-token-0123456789abcdef";
		try {
			const attempt = () =>
				adminLogin(
					req(
						{ "x-real-ip": "192.0.2.44", "content-type": "application/json" },
						{ method: "POST", body: JSON.stringify({ token: "wrong" }) },
						"/auth/login"
					)
				);
			for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
			const res = await attempt();
			expect(res.status).toBe(429);
			expect(res.headers.get("Retry-After")).toBe("60");
			expect(await res.json()).toEqual({ error: "Trop de tentatives, réessayez dans une minute." });
		} finally {
			(env as { API_ADMIN_TOKEN?: string }).API_ADMIN_TOKEN = saved;
		}
	});
});
