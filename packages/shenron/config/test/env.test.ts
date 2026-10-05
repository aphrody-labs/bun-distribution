// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	checkAlias,
	ENV_ALIASES,
	envFirst,
	envString,
	isProduction,
	parseEnv,
	type EnvIssue,
} from "../src/env";

const SECRET = "s3cr3t-value-that-must-never-leak";

function assertNoSecret(issues: readonly EnvIssue[] | EnvIssue | null): void {
	expect(JSON.stringify(issues)).not.toContain(SECRET);
}

describe("envString", () => {
	test("trims and treats blank / undefined / null literals as unset", () => {
		expect(envString({ A: "  value  " }, "A")).toBe("value");
		for (const raw of ["", "   ", "undefined", "null", " null "]) {
			expect(envString({ A: raw }, "A")).toBeUndefined();
		}
		expect(envString({}, "A")).toBeUndefined();
	});
});

describe("envFirst", () => {
	test("returns the first usable name in order", () => {
		expect(envFirst({ B: "2", C: "3" }, ["A", "B", "C"])).toEqual({ name: "B", value: "2" });
		expect(envFirst({ A: " ", B: "null" }, ["A", "B"])).toBeUndefined();
	});
});

describe("isProduction", () => {
	test("is true only for NODE_ENV=production", () => {
		expect(isProduction({ NODE_ENV: "production" })).toBe(true);
		expect(isProduction({ NODE_ENV: " production " })).toBe(true);
		expect(isProduction({ NODE_ENV: "development" })).toBe(false);
		expect(isProduction({})).toBe(false);
	});
});

describe("ENV_ALIASES / checkAlias", () => {
	test("alias table is exactly the documented one", () => {
		expect(ENV_ALIASES).toEqual({
			adminToken: ["SHENRON_ADMIN_TOKEN", "API_ADMIN_TOKEN"],
			actingUserSecret: ["SHENRON_USER_SECRET", "API_USER_SECRET"],
			coordDir: ["A2A_COORD_DIR", "COORD_DIR"],
			ragGold: ["RAG_GOLD_PATH", "RAG_GOLD"],
		});
	});

	test("no issue when zero, one or identical values are set", () => {
		const names = ENV_ALIASES.adminToken;
		expect(checkAlias({}, names)).toBeNull();
		expect(checkAlias({ API_ADMIN_TOKEN: SECRET }, names)).toBeNull();
		expect(
			checkAlias({ SHENRON_ADMIN_TOKEN: SECRET, API_ADMIN_TOKEN: ` ${SECRET} ` }, names)
		).toBeNull();
	});

	test("mismatch names both variables and never a value", () => {
		const issue = checkAlias(
			{ SHENRON_ADMIN_TOKEN: SECRET, API_ADMIN_TOKEN: `${SECRET}-other` },
			ENV_ALIASES.adminToken
		);
		expect(issue?.problem).toBe("mismatch");
		expect(issue?.name).toBe("SHENRON_ADMIN_TOKEN");
		expect(issue?.hint).toContain("API_ADMIN_TOKEN");
		assertNoSecret(issue);
	});
});

describe("parseEnv", () => {
	const schema = z.object({
		TOKEN: z.string().min(64),
		PORT: z.coerce.number().int().default(5006),
		MODE: z.enum(["a", "b"]).optional(),
	});

	test("valid env returns the parsed value, blank values fall back to defaults", () => {
		const token = "x".repeat(64);
		const result = parseEnv(schema, { TOKEN: token, PORT: "  ", MODE: "a" });
		expect(result).toEqual({ ok: true, value: { TOKEN: token, PORT: 5006, MODE: "a" } });
	});

	test("missing and invalid variables are reported by name only", () => {
		const missing = parseEnv(schema, { TOKEN: "undefined" });
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(missing.issues).toEqual([
				expect.objectContaining({ name: "TOKEN", problem: "missing" }),
			]);
		}

		const invalid = parseEnv(schema, { TOKEN: SECRET, MODE: SECRET });
		expect(invalid.ok).toBe(false);
		if (!invalid.ok) {
			expect(invalid.issues.map((issue) => `${issue.name}:${issue.problem}`).toSorted()).toEqual([
				"MODE:invalid",
				"TOKEN:invalid",
			]);
			assertNoSecret(invalid.issues);
		}
	});

	test("a schema echoing the input in its message is scrubbed", () => {
		const echo = z.object({
			KEY: z.string().refine(() => false, { error: (issue) => `bad ${String(issue.input)}` }),
		});
		const result = parseEnv(echo, { KEY: SECRET });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.name).toBe("KEY");
			assertNoSecret(result.issues);
		}
	});
});
