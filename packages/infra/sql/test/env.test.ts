// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	databaseUrlNames,
	isLoopbackHost,
	isPoolerUrl,
	isUsableEnvValue,
	lastAssignment,
	normalizeEnvPrefix,
	redactUrl,
	requireDatabaseUrl,
	resolveDatabaseUrl,
	resolvePoolSize,
	urlHost,
	urlSelectsTls,
} from "../src/env";

const DIRECT = "postgres://u:p@db.internal:5432/train";
const POOLED = "postgres://u:p@db-pooler.internal:5432/train";

describe("env names (D9)", () => {
	test("prefix normalisation", () => {
		expect(normalizeEnvPrefix("aphrody training")).toBe("APHRODY_TRAINING");
		expect(normalizeEnvPrefix("-rg-")).toBe("RG");
	});

	test("pooled lookup tries _POOLED, direct, then fallbacks", () => {
		expect(
			databaseUrlNames({ prefix: "APHRODY_TRAINING", pooled: true, fallbacks: ["DATABASE_URL"] })
		).toEqual([
			"APHRODY_TRAINING_DATABASE_URL_POOLED",
			"APHRODY_TRAINING_DATABASE_URL",
			"DATABASE_URL",
		]);
	});

	test("direct lookup never uses the pooled name", () => {
		expect(databaseUrlNames({ prefix: "rg", fallbacks: ["RG_DATABASE_URL"] })).toEqual([
			"RG_DATABASE_URL",
		]);
	});

	test("resolution order and source reporting", () => {
		const env = {
			APHRODY_TRAINING_DATABASE_URL: DIRECT,
			APHRODY_TRAINING_DATABASE_URL_POOLED: POOLED,
			DATABASE_URL: "postgres://legacy@127.0.0.1/x",
		};
		expect(resolveDatabaseUrl({ env, prefix: "APHRODY_TRAINING", pooled: true })).toEqual({
			url: POOLED,
			name: "APHRODY_TRAINING_DATABASE_URL_POOLED",
			pooled: true,
		});
		expect(resolveDatabaseUrl({ env, prefix: "APHRODY_TRAINING" })).toEqual({
			url: DIRECT,
			name: "APHRODY_TRAINING_DATABASE_URL",
			pooled: false,
		});
	});

	test("existing contract names are honoured as fallbacks", () => {
		const env = { APHRODY_MCP_DATABASE_URL: ` ${DIRECT} ` };
		expect(
			resolveDatabaseUrl({ env, prefix: "APHRODY_MCP_V2", fallbacks: ["APHRODY_MCP_DATABASE_URL"] })
		).toEqual({ url: DIRECT, name: "APHRODY_MCP_DATABASE_URL", pooled: false });
	});

	test("placeholders and encrypted payloads are skipped", () => {
		for (const bad of ["", "undefined", "null", "eyJ2Ijoabc"]) {
			expect(isUsableEnvValue(bad)).toBe(false);
			expect(resolveDatabaseUrl({ env: { DATABASE_URL: bad }, fallbacks: ["DATABASE_URL"] })).toBe(
				null
			);
		}
		expect(isUsableEnvValue(undefined)).toBe(false);
		expect(isUsableEnvValue(null)).toBe(false);
		expect(isUsableEnvValue(" x")).toBe(true);
	});

	test("requireDatabaseUrl names variables, never values", () => {
		let message = "";
		try {
			requireDatabaseUrl({ env: { OTHER: DIRECT }, prefix: "X", pooled: true });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain("X_DATABASE_URL_POOLED, X_DATABASE_URL");
		expect(message).not.toContain("u:p");
	});
});

describe("pool size", () => {
	test("parseInt semantics, fallback and ceiling", () => {
		const opts = { fallback: 4, ceiling: 20 };
		expect(resolvePoolSize(undefined, opts)).toBe(4);
		expect(resolvePoolSize("abc", opts)).toBe(4);
		expect(resolvePoolSize("0", opts)).toBe(4);
		expect(resolvePoolSize("-3", opts)).toBe(4);
		expect(resolvePoolSize(" 7 ", opts)).toBe(7);
		expect(resolvePoolSize("50", opts)).toBe(20);
	});
});

describe("URL helpers", () => {
	test("redactUrl hides passwords and secret parameters", () => {
		expect(redactUrl("postgres://user:s3cret@db.example:5432/app?sslmode=require")).toBe(
			"postgres://user:***@db.example:5432/app?sslmode=require"
		);
		expect(redactUrl("redis://:pw@127.0.0.1:6379")).toBe("redis://:***@127.0.0.1:6379");
		expect(redactUrl("postgres://db/app?password=x&sslpassword=y")).toBe(
			"postgres://db/app?password=***&sslpassword=***"
		);
		expect(redactUrl("redis://127.0.0.1:6379")).toBe("redis://127.0.0.1:6379");
		expect(redactUrl("not a url user:pw@host")).toBe("not a url user:***@host");
	});

	test("hosts, loopback and Unix sockets", () => {
		expect(urlHost("postgres://u@[::1]:5432/x")).toBe("::1");
		expect(urlHost("postgres://u@localhost/x?host=/run/postgresql")).toBe("");
		expect(isLoopbackHost("127.0.0.1")).toBe(true);
		expect(isLoopbackHost("127.1.2.3")).toBe(true);
		expect(isLoopbackHost("localhost")).toBe(true);
		expect(isLoopbackHost("::1")).toBe(true);
		expect(isLoopbackHost("")).toBe(true);
		expect(isLoopbackHost("10.0.0.2")).toBe(false);
		expect(isLoopbackHost("db.example")).toBe(false);
	});

	test("pooler detection", () => {
		expect(isPoolerUrl(POOLED)).toBe(true);
		expect(isPoolerUrl("postgres://u@h:6432/x")).toBe(true);
		expect(isPoolerUrl("postgres://u@h:6543/x")).toBe(true);
		expect(isPoolerUrl("postgres://u@h/x?pgbouncer=true")).toBe(true);
		expect(isPoolerUrl(DIRECT)).toBe(false);
		expect(isPoolerUrl("nope")).toBe(false);
	});

	test("TLS selection in the URL", () => {
		expect(urlSelectsTls("postgres://h/x?sslmode=disable")).toBe(true);
		expect(urlSelectsTls("postgres://h/x")).toBe(false);
	});
});

describe("lastAssignment", () => {
	test("last active line wins; quotes, export and comments handled", () => {
		const text = [
			"DATABASE_URL=postgres://old",
			"# DATABASE_URL=postgres://commented",
			'export DATABASE_URL="postgres://live" ',
			"OTHER=1 # note",
			"QUOTED='a # b'",
		].join("\n");
		expect(lastAssignment(text, "DATABASE_URL")).toBe("postgres://live");
		expect(lastAssignment(text, "OTHER")).toBe("1");
		expect(lastAssignment(text, "QUOTED")).toBe("a # b");
		expect(lastAssignment(text, "MISSING")).toBeUndefined();
	});
});
