// SPDX-License-Identifier: Apache-2.0
/**
 * Mutable data paths (docs/STACK.md D15).
 *
 * Centralises which environment variables may relocate a writable file or
 * directory, while every caller keeps its current default (`legacyDefault`,
 * returned byte for byte). In production a path that still comes from the
 * legacy default (relative to the immutable release) is reported once per key
 * and per process. Nothing here throws or blocks a read: making these paths
 * mandatory in production is ticket SH-PATHS, after INFRA-1.
 *
 * Runtime class: `server` (consumed by Bun and Next server code only).
 */
import { envFirst, isProduction, type EnvSource } from "./env";

export type DataPathKey =
	| "ragGold"
	| "adminDocsDir"
	| "coordDir"
	| "databooksFreezeFile"
	| "ragLexique";

/** Variables that may relocate each path, in priority order (first set wins). */
export const DATA_PATH_ENV: Readonly<Record<DataPathKey, readonly string[]>> = Object.freeze({
	ragGold: Object.freeze(["RAG_GOLD_PATH", "RAG_GOLD"]),
	adminDocsDir: Object.freeze(["SHENRON_ADMIN_DOCS_DIR"]),
	coordDir: Object.freeze(["A2A_COORD_DIR", "COORD_DIR"]),
	databooksFreezeFile: Object.freeze(["DATABOOKS_FREEZE_FILE"]),
	ragLexique: Object.freeze(["RAG_LEXIQUE"]),
});

export interface DataPath {
	key: DataPathKey;
	path: string;
	source: "env" | "legacy-default";
	envName: string | null;
}

/**
 * Resolves `key` from the first set variable of {@link DATA_PATH_ENV}, else
 * returns `legacyDefault` unchanged.
 */
export function resolveDataPath(
	key: DataPathKey,
	ctx: { env: EnvSource; legacyDefault: string }
): DataPath {
	const hit = envFirst(ctx.env, DATA_PATH_ENV[key]);
	if (hit) return { key, path: hit.value, source: "env", envName: hit.name };
	return { key, path: ctx.legacyDefault, source: "legacy-default", envName: null };
}

const warnedKeys = new Set<DataPathKey>();

/**
 * Logs once per key and per process when, in production, `p` still comes from
 * its legacy default. The message names the variables to set, never a value
 * other than the (non-secret) path itself.
 */
export function warnIfEphemeral(p: DataPath, env: EnvSource, log: (message: string) => void): void {
	if (p.source !== "legacy-default" || !isProduction(env) || warnedKeys.has(p.key)) return;
	warnedKeys.add(p.key);
	log(
		`[shenron/config] ${p.key}: production is using the legacy default path "${p.path}" (inside the release, may be read-only or lost at the next release); set ${DATA_PATH_ENV[p.key].join(" or ")} (INFRA-1).`
	);
}

/** Test hook: forgets which keys already warned in this process. */
export function resetEphemeralWarnings(): void {
	warnedKeys.clear();
}
