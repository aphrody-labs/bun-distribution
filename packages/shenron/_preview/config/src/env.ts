// SPDX-License-Identifier: Apache-2.0
/**
 * Environment reading discipline shared by every `@shenron/*` package.
 *
 * Runtime class: `pure`. Nothing here reads `process.env` on its own: the
 * caller always passes an {@link EnvSource} (usually `process.env`) at call
 * time, so importing this module is side-effect free in any runtime.
 *
 * Every {@link EnvIssue} carries a variable name and a problem kind, never a
 * value: issues can be logged, returned in a health payload or serialised in a
 * test report without leaking a secret.
 */
import type { z } from "zod";

/** Read-only view over an environment (`process.env`, `Bun.env` or a test object). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Problem found while reading the environment. Never carries a value. */
export interface EnvIssue {
	readonly name: string;
	readonly problem: "missing" | "invalid" | "mismatch" | "deprecated";
	readonly hint?: string;
}

/** Values that shell interpolation accidents produce and that mean "unset". */
const UNSET_LITERALS = new Set(["", "undefined", "null"]);

/**
 * Trimmed value of `name`, or `undefined` when the variable is absent, blank,
 * or holds the literal strings `"undefined"` / `"null"`.
 */
export function envString(env: EnvSource, name: string): string | undefined {
	const raw = env[name];
	if (typeof raw !== "string") return undefined;
	const value = raw.trim();
	return UNSET_LITERALS.has(value) ? undefined : value;
}

/** First variable of `names` that holds a usable value (see {@link envString}). */
export function envFirst(
	env: EnvSource,
	names: readonly string[]
): { name: string; value: string } | undefined {
	for (const name of names) {
		const value = envString(env, name);
		if (value !== undefined) return { name, value };
	}
	return undefined;
}

/** `true` only when `NODE_ENV` is exactly `production` (after trimming). */
export function isProduction(env: EnvSource): boolean {
	return envString(env, "NODE_ENV") === "production";
}

/**
 * Historical name pairs that must hold the same value when both are set. The
 * first name of each tuple is the canonical one.
 */
export const ENV_ALIASES = {
	adminToken: ["SHENRON_ADMIN_TOKEN", "API_ADMIN_TOKEN"],
	actingUserSecret: ["SHENRON_USER_SECRET", "API_USER_SECRET"],
	coordDir: ["A2A_COORD_DIR", "COORD_DIR"],
	ragGold: ["RAG_GOLD_PATH", "RAG_GOLD"],
} as const satisfies Record<string, readonly [string, string]>;

/**
 * Returns a `mismatch` issue when at least two of `names` are set to different
 * values, `null` otherwise. The issue names the variables, never the values.
 */
export function checkAlias(env: EnvSource, names: readonly string[]): EnvIssue | null {
	const set: { name: string; value: string }[] = [];
	for (const name of names) {
		const value = envString(env, name);
		if (value !== undefined) set.push({ name, value });
	}
	const first = set[0];
	if (!first) return null;
	const other = set.find((entry) => entry.value !== first.value);
	if (!other) return null;
	return {
		name: first.name,
		problem: "mismatch",
		hint: `${first.name} and ${other.name} are both set with different values; set one value for ${names.join(", ")}`,
	};
}

/** Minimal view of a zod issue: only the fields this module reads. */
interface ZodIssueLike {
	readonly code: string;
	readonly path: readonly PropertyKey[];
	readonly message: string;
}

/**
 * Removes every occurrence of `secrets` from `text`. Values shorter than three
 * characters are not scrubbed: they cannot be secrets and would shred hints.
 */
function scrub(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const secret of secrets) {
		if (secret.length < 3) continue;
		out = out.split(secret).join("[redacted]");
	}
	return out;
}

/**
 * Validates `env` with a zod object schema. Values are normalised with
 * {@link envString} first, so a blank variable behaves exactly like an absent
 * one (defaults and `.optional()` apply). Issues carry variable names only.
 */
export function parseEnv<S extends z.ZodType>(
	schema: S,
	env: EnvSource
): { ok: true; value: z.infer<S> } | { ok: false; issues: readonly EnvIssue[] } {
	const normalised: Record<string, string | undefined> = {};
	for (const name of Object.keys(env)) {
		const value = envString(env, name);
		if (value !== undefined) normalised[name] = value;
	}
	const result = schema.safeParse(normalised);
	if (result.success) return { ok: true, value: result.data as z.infer<S> };

	const issues: EnvIssue[] = [];
	const seen = new Set<string>();
	for (const issue of result.error.issues as readonly ZodIssueLike[]) {
		const head = issue.path[0];
		const name = typeof head === "string" ? head : head === undefined ? "(root)" : String(head);
		const raw = typeof head === "string" ? env[head] : undefined;
		const secrets = typeof raw === "string" ? [raw, raw.trim()] : [];
		const missing = typeof head === "string" && normalised[head] === undefined;
		const problem: EnvIssue["problem"] = missing ? "missing" : "invalid";
		const key = `${name}\u0000${problem}`;
		if (seen.has(key)) continue;
		seen.add(key);
		issues.push({ name, problem, hint: scrub(issue.message, secrets) });
	}
	return { ok: false, issues };
}
