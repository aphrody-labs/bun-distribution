// SPDX-License-Identifier: Apache-2.0
/**
 * Database environment and URL helpers (ADR sql-convergence D9).
 *
 * Runtime-neutral: no `bun`, `node:` or DOM import and no environment read at
 * module load, so the module is safe in Bun, Node, Next server code and browser
 * bundles. Every function reads the environment it is given (default
 * `process.env` when it exists) at call time. Values are never logged.
 */

/** Minimal environment shape (compatible with `process.env` and `Bun.env`). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Prefix that marks a dotenvx payload which was never decrypted. */
export const ENCRYPTED_ENV_PREFIX = "eyJ2Ijo";

function defaultEnv(): EnvSource {
	const proc = (globalThis as { process?: { env?: EnvSource } }).process;
	return proc?.env ?? {};
}

/**
 * True for a value that can be used as-is: a non-empty string that is not the
 * literal `"undefined"`/`"null"` (shell interpolation accidents) nor an
 * undecrypted dotenvx payload. The value is not trimmed.
 */
export function isUsableEnvValue(value: string | undefined | null): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value !== "undefined" &&
		value !== "null" &&
		!value.startsWith(ENCRYPTED_ENV_PREFIX)
	);
}

/** `APHRODY training` → `APHRODY_TRAINING`. */
export function normalizeEnvPrefix(prefix: string): string {
	return prefix
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export interface DatabaseUrlNamesOptions {
	/** Domain prefix, e.g. `APHRODY_TRAINING` → `APHRODY_TRAINING_DATABASE_URL`. */
	prefix?: string;
	/** Runtime use: try `<PREFIX>_DATABASE_URL_POOLED` before the direct URL. */
	pooled?: boolean;
	/** Existing contract names tried after the D9 names, in order (e.g. `DATABASE_URL`). */
	fallbacks?: readonly string[];
}

/**
 * Ordered variable names for a database URL. Pooled lookups try
 * `<PREFIX>_DATABASE_URL_POOLED` then `<PREFIX>_DATABASE_URL`; direct lookups
 * (migrations, COPY, LISTEN) never use the pooled name. Fallback contract
 * names come last. Duplicates are removed.
 */
export function databaseUrlNames(options: DatabaseUrlNamesOptions = {}): string[] {
	const names: string[] = [];
	if (options.prefix !== undefined) {
		const prefix = normalizeEnvPrefix(options.prefix);
		const base = prefix ? `${prefix}_DATABASE_URL` : "DATABASE_URL";
		if (options.pooled) names.push(`${base}_POOLED`);
		names.push(base);
	}
	for (const name of options.fallbacks ?? []) names.push(name);
	return [...new Set(names)];
}

export interface ResolveDatabaseUrlOptions extends DatabaseUrlNamesOptions {
	/** Environment source; defaults to `process.env` at call time. */
	env?: EnvSource;
}

export interface ResolvedDatabaseUrl {
	url: string;
	/** Variable that provided the URL. */
	name: string;
	/** True when the value came from a `*_POOLED` variable. */
	pooled: boolean;
}

/** First usable URL among {@link databaseUrlNames}, or `null`. Never throws. */
export function resolveDatabaseUrl(
	options: ResolveDatabaseUrlOptions = {}
): ResolvedDatabaseUrl | null {
	const env = options.env ?? defaultEnv();
	for (const name of databaseUrlNames(options)) {
		const raw = env[name]?.trim();
		if (isUsableEnvValue(raw)) return { url: raw, name, pooled: name.endsWith("_POOLED") };
	}
	return null;
}

/** Like {@link resolveDatabaseUrl} but throws an error naming the variables tried (never values). */
export function requireDatabaseUrl(options: ResolveDatabaseUrlOptions = {}): ResolvedDatabaseUrl {
	const resolved = resolveDatabaseUrl(options);
	if (resolved) return resolved;
	const tried = databaseUrlNames(options);
	throw new Error(
		`No database URL configured (tried ${tried.length ? tried.join(", ") : "no variable"}).`
	);
}

export interface PoolSizeOptions {
	/** Value used when the raw value is missing, invalid or not positive. */
	fallback: number;
	/** Upper bound applied to a valid raw value. */
	ceiling: number;
}

/** Parses a pool size such as `DATABASE_POOL_MAX` (`parseInt` semantics). */
export function resolvePoolSize(raw: string | undefined, options: PoolSizeOptions): number {
	const value = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(value) || value <= 0) return options.fallback;
	return Math.min(value, options.ceiling);
}

const SECRET_PARAMS = /^(password|pass|sslpassword|sslkey|token|secret|api[_-]?key)$/i;

/**
 * URL with the password and secret-looking query parameters replaced by
 * `***`. Unparseable input is redacted with a `:secret@` pattern.
 */
export function redactUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url.replace(/:[^:@/]+@/, ":***@");
	}
	if (parsed.password) parsed.password = "***";
	for (const key of Array.from(parsed.searchParams.keys())) {
		if (SECRET_PARAMS.test(key)) parsed.searchParams.set(key, "***");
	}
	return parsed.toString();
}

/** Host of a connection URL, `""` for a Unix socket or unparseable URL. */
export function urlHost(url: string): string {
	try {
		const parsed = new URL(url);
		const socketHost = parsed.searchParams.get("host");
		if (socketHost?.startsWith("/")) return "";
		return parsed.hostname.replace(/^\[|\]$/g, "");
	} catch {
		return "";
	}
}

/** Loopback or local socket host (`localhost`, `127.0.0.0/8`, `::1`, empty). */
export function isLoopbackHost(host: string): boolean {
	const h = host.toLowerCase();
	return (
		h === "" ||
		h === "localhost" ||
		h.endsWith(".localhost") ||
		h === "::1" ||
		/^127(?:\.\d{1,3}){3}$/.test(h)
	);
}

/** Ports used by PgBouncer (6432) and Supavisor transaction mode (6543). */
export const POOLER_PORTS: readonly string[] = ["6432", "6543"];

/**
 * True when a PostgreSQL URL points at a transaction pooler (PgBouncer,
 * Supavisor, the Neon `-pooler` endpoint) where server-side prepared
 * statements must be disabled.
 */
export function isPoolerUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.hostname.includes("-pooler.")) return true;
		if (POOLER_PORTS.includes(parsed.port)) return true;
		const flag = parsed.searchParams.get("pgbouncer");
		return flag === "true" || flag === "1";
	} catch {
		return false;
	}
}

/** True when the URL already selects a TLS mode (`sslmode`, `ssl` or `tls` parameter). */
export function urlSelectsTls(url: string): boolean {
	try {
		const params = new URL(url).searchParams;
		return params.has("sslmode") || params.has("ssl") || params.has("tls");
	} catch {
		return false;
	}
}

function stripQuotes(value: string): string {
	const v = value.trim();
	if (v.length >= 2) {
		const first = v[0];
		const last = v[v.length - 1];
		if ((first === '"' || first === "'" || first === "`") && last === first) return v.slice(1, -1);
	}
	return v;
}

/**
 * Last active `NAME=value` of a dotenv text (comments and `export ` handled,
 * quotes stripped, unquoted inline ` #` comments dropped). The last line wins
 * so a decommissioned URL left above the live one is never picked.
 */
export function lastAssignment(text: string, name: string): string | undefined {
	let found: string | undefined;
	for (const rawLine of text.split(/\r?\n/)) {
		let line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		if (line.startsWith("export ")) line = line.slice(7).trimStart();
		const eq = line.indexOf("=");
		if (eq <= 0 || line.slice(0, eq).trim() !== name) continue;
		let value = line.slice(eq + 1).trim();
		if (!/^["'`]/.test(value)) {
			const hash = value.search(/\s#/);
			if (hash !== -1) value = value.slice(0, hash).trim();
		}
		found = stripQuotes(value);
	}
	return found;
}
