// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	clientIpFromHeaders,
	isDirectLoopback,
	isLoopbackHost,
	parseHttpsOrLoopbackUrl,
	parseLoopbackHttpUrl,
} from "../src/net";

describe("isLoopbackHost", () => {
	test("accepts exactly the loopback forms accepted by compute.ts (+ bare ::1)", () => {
		for (const host of ["127.0.0.1", "[::1]", "::1", "localhost"])
			expect(isLoopbackHost(host)).toBe(true);
	});
	test("does not widen to 127/8, private ranges or look-alikes", () => {
		const rejected = [
			"127.0.0.2",
			"127.1.2.3",
			"10.0.0.1",
			"192.168.1.10",
			"0.0.0.0",
			"localhost.evil",
			"",
		];
		for (const host of rejected) expect(isLoopbackHost(host)).toBe(false);
	});
});

describe("parseLoopbackHttpUrl", () => {
	test("accepts http loopback URLs and strips search and hash", () => {
		const ipv4 = parseLoopbackHttpUrl("http://127.0.0.1:8789/api?token=x#frag", "APHRODY_URL");
		expect(ipv4.ok && ipv4.url.href).toBe("http://127.0.0.1:8789/api");
		const ipv6 = parseLoopbackHttpUrl("http://[::1]:8794/v1", "EMBED_URL");
		expect(ipv6.ok && ipv6.url.hostname).toBe("[::1]");
		expect(parseLoopbackHttpUrl("http://localhost:5006", "X").ok).toBe(true);
	});
	test("rejects userinfo, https, private hosts, garbage and absence", () => {
		const cases: [string | undefined, "missing" | "invalid"][] = [
			["http://user:pass@127.0.0.1:8789", "invalid"],
			["http://user@localhost", "invalid"],
			["https://127.0.0.1:8789", "invalid"],
			["http://192.168.1.20:8789", "invalid"],
			["http://127.0.0.2:8789", "invalid"],
			["not a url", "invalid"],
			[undefined, "missing"],
			["  ", "missing"],
		];
		for (const [raw, problem] of cases) {
			const result = parseLoopbackHttpUrl(raw, "APHRODY_URL");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issue).toMatchObject({ name: "APHRODY_URL", problem });
				expect(JSON.stringify(result.issue)).not.toContain("pass@");
			}
		}
	});
});

describe("parseHttpsOrLoopbackUrl", () => {
	test("accepts https anywhere and http on loopback only", () => {
		const remote = parseHttpsOrLoopbackUrl("https://mcp.example.test/a2a?x=1#y", "HUB");
		expect(remote.ok && remote.url.href).toBe("https://mcp.example.test/a2a");
		expect(parseHttpsOrLoopbackUrl("http://[::1]:5010", "HUB").ok).toBe(true);
	});
	test("rejects plain http off loopback, userinfo and other schemes", () => {
		expect(parseHttpsOrLoopbackUrl("http://10.0.0.5", "HUB").ok).toBe(false);
		expect(parseHttpsOrLoopbackUrl("https://a:b@mcp.example.test", "HUB").ok).toBe(false);
		expect(parseHttpsOrLoopbackUrl("ftp://127.0.0.1", "HUB").ok).toBe(false);
	});
});

/** Copy of the site doctrine (`apps/site/src/app/api/_client-ip.ts`) used as the parity oracle. */
function siteClientIp(req: Request): string {
	const realIp = req.headers.get("x-real-ip")?.trim();
	if (realIp) return realIp;
	const xff = req.headers.get("x-forwarded-for");
	if (xff) {
		const parts = xff
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (parts.length) return parts[parts.length - 1] as string;
	}
	return "unknown";
}

describe("clientIpFromHeaders", () => {
	const table: [Record<string, string>, string][] = [
		[{ "x-real-ip": "203.0.113.7" }, "203.0.113.7"],
		[{ "x-real-ip": " 203.0.113.7 ", "x-forwarded-for": "1.1.1.1" }, "203.0.113.7"],
		[{ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }, "198.51.100.4"],
		[{ "x-forwarded-for": "spoofed-leftmost, 10.1.1.1, 198.51.100.9 " }, "198.51.100.9"],
		[{ "x-forwarded-for": " , , " }, "unknown"],
		[{ "x-real-ip": "   " }, "unknown"],
		[{}, "unknown"],
	];
	test("parity with the site _client-ip.ts doctrine", () => {
		for (const [headers, expected] of table) {
			const request = new Request("http://127.0.0.1/", { headers });
			expect(clientIpFromHeaders(request.headers)).toBe(expected);
			expect(clientIpFromHeaders(request.headers)).toBe(siteClientIp(request));
		}
	});
});

describe("isDirectLoopback", () => {
	test("loopback socket without proxy headers only", () => {
		const bare = new Headers();
		expect(isDirectLoopback(bare, "127.0.0.1")).toBe(true);
		expect(isDirectLoopback(bare, "::1")).toBe(true);
		expect(isDirectLoopback(bare, "::ffff:127.0.0.1")).toBe(true);
		expect(isDirectLoopback(bare, "10.0.0.1")).toBe(false);
		expect(isDirectLoopback(bare, "127.0.0.2")).toBe(false);
		expect(isDirectLoopback(bare, null)).toBe(false);
		expect(isDirectLoopback(bare, undefined)).toBe(false);
		expect(isDirectLoopback(new Headers({ "x-real-ip": "203.0.113.1" }), "127.0.0.1")).toBe(false);
		expect(isDirectLoopback(new Headers({ "x-forwarded-for": "127.0.0.1" }), "127.0.0.1")).toBe(
			false
		);
	});
});
