// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ApiErrorCode, ErrorEnvelope } from "./index";

describe("ErrorEnvelope", () => {
	test('parses the legacy body {"error":"Not found"}', () => {
		expect(ErrorEnvelope.parse(JSON.parse('{"error":"Not found"}'))).toEqual({
			error: "Not found",
		});
	});

	test("accepts a typed code and a message, rejects unknown codes", () => {
		expect(
			ErrorEnvelope.parse({ error: "Too many requests", code: "rate_limited", message: "retry" })
		).toEqual({
			error: "Too many requests",
			code: "rate_limited",
			message: "retry",
		});
		expect(ErrorEnvelope.safeParse({ error: "x", code: "teapot" }).success).toBe(false);
		expect(ErrorEnvelope.safeParse({ code: "internal" }).success).toBe(false);
	});

	test("codes and meta ids are stable", () => {
		expect(ApiErrorCode.options).toEqual([
			"not_found",
			"invalid_request",
			"rate_limited",
			"unauthenticated",
			"forbidden",
			"pg_unavailable",
			"upstream_unavailable",
			"internal",
		]);
		expect(ErrorEnvelope.meta()?.id).toBe("ErrorEnvelope");
		expect(ApiErrorCode.meta()?.id).toBe("ApiErrorCode");
		expect(JSON.stringify(z.toJSONSchema(ErrorEnvelope))).toContain('"required":["error"]');
	});
});
