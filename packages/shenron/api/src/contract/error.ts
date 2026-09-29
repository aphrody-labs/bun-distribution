// SPDX-License-Identifier: Apache-2.0
/**
 * Error envelope of every Shenron HTTP API (docs/STACK.md §3.6).
 *
 * Runtime class: `pure` — plain zod with `.meta({ id })`, no hono import, so
 * a browser bundle can validate API errors without pulling the server.
 */
import { z } from "zod";

export const ApiErrorCode = z
	.enum([
		"not_found",
		"invalid_request",
		"rate_limited",
		"unauthenticated",
		"forbidden",
		"pg_unavailable",
		"upstream_unavailable",
		"internal",
	])
	.meta({ id: "ApiErrorCode" });

export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/**
 * `{ error, code?, message? }` — compatible with the legacy bodies such as
 * `{ "error": "Not found" }` returned by the bot and the site today.
 */
export const ErrorEnvelope = z
	.object({
		error: z.string(),
		code: ApiErrorCode.optional(),
		message: z.string().optional(),
	})
	.meta({ id: "ErrorEnvelope" });

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
