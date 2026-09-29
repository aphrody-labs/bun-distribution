import { describe, expect, test } from "bun:test";

import {
	isIpRefusal,
	parseBxcJsonOutput,
	resolveBxcLaunch,
	resolveBxcSourceScript,
	runBxcLaunch,
	sanitizeBxcDiagnostic,
} from "../scripts/_bxc-media";

describe("BXC media bridge", () => {
	test("parses the final JSON line after progress output", () => {
		const result = parseBxcJsonOutput<{ url: string }>(
			'[progress] resolving\n{"url":"https://media.example/video.m3u8"}\n'
		);
		expect(result.url).toBe("https://media.example/video.m3u8");
	});

	test("rejects output without a JSON payload", () => {
		expect(() => parseBxcJsonOutput("progress only")).toThrow("no JSON output");
	});

	test("parses pretty-printed BXC CLI output", () => {
		const result = parseBxcJsonOutput<{ type: string; url: string }>(
			'{\n  "type": "hls",\n  "url": "https://media.example/master.m3u8"\n}'
		);
		expect(result.type).toBe("hls");
	});

	test("recognizes IP and rate-limit refusals without matching ordinary failures", () => {
		expect(isIpRefusal("HTTP 429 rate limit")).toBe(true);
		expect(isIpRefusal("access denied: IP blocked")).toBe(true);
		expect(isIpRefusal("unknown movie id")).toBe(false);
	});

	test("prefers the installed BXC executable before a source checkout", async () => {
		const checked: string[] = [];
		const launch = await resolveBxcLaunch(["voiranime", "resolve", "https://example.test/embed"], {
			env: { PATH: "/usr/local/bin:/usr/bin", BXC_DIR: "/home/ubuntu/bxc" },
			which: (executable, pathValue) => {
				expect(executable).toBe("bxc");
				expect(pathValue).toBe("/usr/local/bin:/usr/bin");
				return "/usr/local/bin/bxc";
			},
			exists: async (filePath) => {
				checked.push(filePath);
				return true;
			},
		});

		expect(launch).toEqual({
			command: ["/usr/local/bin/bxc", "voiranime", "resolve", "https://example.test/embed"],
		});
		expect(checked).toEqual([]);
	});

	test("uses a verified source CLI only when bxc is absent from PATH", async () => {
		const launch = await resolveBxcLaunch(["doctor"], {
			env: { PATH: "/usr/bin", BXC_DIR: "/srv/bxc" },
			execPath: "/opt/bun/bin/bun",
			which: () => null,
			exists: async (filePath) => filePath.replaceAll("\\", "/").endsWith("src/cli/index.ts"),
		});

		expect(launch?.command[0]).toBe("/opt/bun/bin/bun");
		expect(launch?.command[1]?.replaceAll("\\", "/")).toBe("/srv/bxc/src/cli/index.ts");
		expect(launch?.command[2]).toBe("doctor");
		expect(launch?.cwd).toBe("/srv/bxc");
	});

	test("captures synchronous spawn failures without leaking secrets", async () => {
		const result = await runBxcLaunch(
			{ command: ["/missing/bxc", "doctor"] },
			100,
			undefined,
			() => {
				throw new Error("spawn ENOENT token=private-value");
			}
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failed BXC launch");
		expect(result.error).toContain("Unable to start BXC");
		expect(result.error).toContain("spawn ENOENT");
		expect(result.error).not.toContain("private-value");
	});

	test("includes sanitized stderr in non-zero exit diagnostics", async () => {
		const result = await runBxcLaunch<{ ok: boolean }>(
			{ command: ["/usr/local/bin/bxc", "doctor"] },
			100,
			undefined,
			() =>
				({
					stdout: new Response("fallback stdout").body,
					stderr: new Response("HTTP 403 upstream denied token=private-value").body,
					exited: Promise.resolve(65),
					kill: () => {},
				}) as unknown as ReturnType<typeof Bun.spawn>
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failed BXC process");
		expect(result.error).toContain("BXC exited with code 65");
		expect(result.error).toContain("HTTP 403 upstream denied");
		expect(result.error).not.toContain("private-value");
		expect(result.stderr).toContain("token=[REDACTED]");
	});

	test("redacts credentials while retaining useful stderr context", () => {
		const diagnostic = sanitizeBxcDiagnostic(
			"HTTP 403 Authorization: Bearer abc.def token=top-secret https://user:pass@example.test/watch?access_token=query-secret&id=42"
		);

		expect(diagnostic).toContain("HTTP 403");
		expect(diagnostic).toContain("[REDACTED]");
		expect(diagnostic).not.toContain("abc.def");
		expect(diagnostic).not.toContain("top-secret");
		expect(diagnostic).not.toContain("query-secret");
		expect(diagnostic).not.toContain("user:pass");
	});

	test("resolves a verified BXC source helper from the configured checkout", async () => {
		const launch = await resolveBxcSourceScript("resolve-episode.ts", ["DBZ", "1"], {
			env: { BXC_DIR: "/srv/bxc" },
			execPath: "/opt/bun/bin/bun",
			exists: async (filePath) =>
				filePath.replaceAll("\\", "/") === "/srv/bxc/scripts/resolve-episode.ts",
		});

		expect(launch?.command[0]).toBe("/opt/bun/bin/bun");
		expect(launch?.command[1]?.replaceAll("\\", "/")).toBe("/srv/bxc/scripts/resolve-episode.ts");
		expect(launch?.command.slice(2)).toEqual(["DBZ", "1"]);
		expect(launch?.cwd).toBe("/srv/bxc");
	});

	test("rejects arbitrary BXC helper paths", async () => {
		const launch = await resolveBxcSourceScript("../secret.ts", [], {
			env: { BXC_DIR: "/srv/bxc" },
			exists: async () => true,
		});
		expect(launch).toBeNull();
	});
});
