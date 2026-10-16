import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolveAuthSecret, resolveTrustedOrigins } from "./runtime-config";

test("production authentication requires a private secret instead of the previous placeholder", () => {
	expect(() => resolveAuthSecret({ NODE_ENV: "production" })).toThrow("required");
	expect(() => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: " " })).toThrow(
		"required",
	);
	expect(() => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short" })).toThrow(
		"32",
	);
	expect(() =>
		resolveAuthSecret({
			NODE_ENV: "production",
			BETTER_AUTH_SECRET:
				"build-placeholder-secret-not-used-at-runtime-only-prevents-prerender-throw",
		}),
	).toThrow("private");
	expect(resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "a".repeat(64) })).toBe(
		"a".repeat(64),
	);
});

test("the actual auth factory rejects a missing production secret before opening a database", async () => {
	const factory = fileURLToPath(new URL("./factory.ts", import.meta.url));
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			`const { createRoseGriffonAuth } = await import(${JSON.stringify(factory)}); createRoseGriffonAuth({ database: undefined, baseURL: "https://rg.aphrody.com", sendEmail: async () => {} });`,
		],
		{
			env: {
				...process.env,
				NODE_ENV: "production",
				NEXT_PHASE: "",
				BETTER_AUTH_SECRET: "",
				DATABASE_URL: "",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stderr = await new Response(child.stderr).text();
	expect(stderr).toContain("BETTER_AUTH_SECRET is required for production authentication");
	expect(await child.exited).toBe(1);
});

test("only the explicit Next build phase permits an ephemeral production secret", () => {
	const build = { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" };
	const first = resolveAuthSecret(build);
	expect(first).toHaveLength(43);
	expect(resolveAuthSecret(build)).not.toBe(first);
	expect(() =>
		resolveAuthSecret({ NODE_ENV: "production", NEXT_PHASE: "phase-production-server" }),
	).toThrow("required");
	expect(() => resolveAuthSecret({ NODE_ENV: "production", NEXT_PHASE: "development" })).toThrow(
		"required",
	);
});

test("production trusted origins include the canonical RG domain and exclude development servers", () => {
	const origins = resolveTrustedOrigins("https://rg.aphrody.com/api/auth", true);
	expect(origins.filter((value) => value === "https://rg.aphrody.com")).toHaveLength(1);
	expect(origins).toContain("tauri://localhost");
	expect(origins).not.toContain("http://localhost:3000");
	expect(origins).not.toContain("http://127.0.0.1:5011");
	expect(() => resolveTrustedOrigins("http://rg.aphrody.com", true)).toThrow("HTTPS");
	expect(() => resolveTrustedOrigins("https://localhost:3000", true)).toThrow("loopback");
	expect(() => resolveTrustedOrigins("https://user:password@rg.aphrody.com", true)).toThrow(
		"credentials",
	);
	expect(resolveTrustedOrigins("http://localhost:3004", false)).toContain("http://localhost:3004");
	expect(resolveTrustedOrigins("http://localhost:3004", false)).toContain("http://localhost:3000");
});
