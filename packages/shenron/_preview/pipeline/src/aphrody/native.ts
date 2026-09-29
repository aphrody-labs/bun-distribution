// SPDX-License-Identifier: Apache-2.0
/**
 * @shenron/pipeline/aphrody/native — Direct in-process native C-ABI bindings for Aphrody AI via `bun:ffi`.
 *
 * Calls `aphrody_ffi.dll` directly inside the Bun process without spawning child processes.
 * Provides transparent zero-cost fallback if the native library is not found or fails to load.
 */

import { CString, dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AphrodyDoctorResult, CliResult } from "./cli";
import type { AphrodyRagHit, AphrodyRagStats } from "./compute";

export const EXPECTED_ABI_VERSION = 1;

export interface ShenronAuthStatus {
	configured: boolean;
	adminCredentialsPresent: boolean;
}

const ENCODER = new TextEncoder();

function cstr(text: string): Uint8Array {
	return ENCODER.encode(`${text}\0`);
}

function resolveFfiLibraryPath(): string | null {
	const override = process.env.SHENRON_FFI_LIB || process.env.APHRODY_FFI_LIB;
	if (override && existsSync(override)) return override;

	const prefix = process.platform === "win32" ? "" : "lib";
	const fileName = `${prefix}aphrody_ffi.${suffix}`;

	// Known build target paths
	const home = process.env.USERPROFILE || process.env.HOME || ".";
	const candidates = [
		join(home, "src", "target", "release", fileName),
		join(home, "src", "target", "debug", fileName),
		join(home, "src", "target", "debug", "deps", fileName),
		join(home, "src", "aphrody-ai", "target", "release", fileName),
		join(home, "src", "aphrody-ai", "target", "debug", fileName),
		join(home, "src", "aphrody-ai", "target", "debug", "deps", fileName),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

interface AphrodyFfiSymbols {
	shenron_abi_version: () => number;
	shenron_version: () => { toString(): string };
	shenron_run_captured: (argsJson: Uint8Array) => number;
	shenron_rag_search: (query: Uint8Array, limit: number, kind: Uint8Array | null) => number;
	shenron_rag_stats: () => number;
	shenron_auth_status: () => number;
	shenron_persona_prompt: () => { toString(): string };
	shenron_string_free: (ptr: number) => void;
}

let nativeLib: { symbols: AphrodyFfiSymbols } | null = null;
let nativeInitAttempted = false;

function loadNativeLibrary(): { symbols: AphrodyFfiSymbols } | null {
	if (nativeInitAttempted) return nativeLib;
	nativeInitAttempted = true;

	const libPath = resolveFfiLibraryPath();
	if (!libPath) return null;

	try {
		const loaded = dlopen(libPath, {
			shenron_abi_version: { args: [], returns: FFIType.u32 },
			shenron_version: { args: [], returns: FFIType.cstring },
			shenron_run_captured: { args: [FFIType.cstring], returns: FFIType.ptr },
			shenron_rag_search: {
				args: [FFIType.cstring, FFIType.i32, FFIType.cstring],
				returns: FFIType.ptr,
			},
			shenron_rag_stats: { args: [], returns: FFIType.ptr },
			shenron_auth_status: { args: [], returns: FFIType.ptr },
			shenron_persona_prompt: { args: [], returns: FFIType.cstring },
			shenron_string_free: { args: [FFIType.ptr], returns: FFIType.void },
		});
		nativeLib = loaded as unknown as { symbols: AphrodyFfiSymbols };
		return nativeLib;
	} catch (err) {
		console.warn("[aphrody:native] Failed to dlopen native library:", err);
		return null;
	}
}

/** Check whether in-process native Aphrody FFI is loaded and available. */
export function isNativeAvailable(): boolean {
	return loadNativeLibrary() !== null;
}

/** Report native library ABI version or null. */
export function nativeAbiVersion(): number | null {
	const lib = loadNativeLibrary();
	return lib ? lib.symbols.shenron_abi_version() : null;
}

/** Report native aphrody version string or null. */
export function nativeVersion(): string | null {
	const lib = loadNativeLibrary();
	return lib ? lib.symbols.shenron_version().toString() : null;
}

/**
 * Execute an aphrody command in-process, capturing stdout/stderr and exit code.
 */
export function runCapturedNative(
	args: readonly string[]
): { code: number; stdout: string; stderr: string } | null {
	const lib = loadNativeLibrary();
	if (!lib) return null;

	const jsonStr = JSON.stringify(args);
	const ptr = lib.symbols.shenron_run_captured(cstr(jsonStr));
	if (!ptr) return null;

	try {
		const resultText = new CString(ptr).toString();
		return JSON.parse(resultText);
	} catch {
		return null;
	} finally {
		lib.symbols.shenron_string_free(ptr);
	}
}

/**
 * High-level native client exposing in-process Aphrody operations.
 */
export class AphrodyNativeClient {
	readonly isAvailable: boolean;

	constructor() {
		this.isAvailable = isNativeAvailable();
	}

	/** Run a command and return classified CliResult. */
	async run<T = unknown>(args: readonly string[]): Promise<CliResult<T>> {
		const t0 = performance.now();
		const captured = runCapturedNative(args);
		const durationMs = Math.round(performance.now() - t0);

		if (!captured) {
			return {
				kind: "not_found",
				bin: "aphrody_ffi",
				message: "Native FFI library not available on this platform",
			};
		}

		if (captured.code === 0) {
			try {
				const data = JSON.parse(captured.stdout.trim()) as T;
				return {
					kind: "exit",
					ok: true,
					code: 0,
					data,
					stdout: captured.stdout,
					stderr: captured.stderr,
					durationMs,
				};
			} catch {
				return {
					kind: "exit",
					ok: true,
					code: 0,
					data: undefined,
					stdout: captured.stdout,
					stderr: captured.stderr,
					durationMs,
				};
			}
		}

		return {
			kind: "exit",
			ok: false,
			code: captured.code,
			stdout: captured.stdout,
			stderr: captured.stderr,
			durationMs,
		};
	}

	/** Fetch full sovereign doctor diagnostics in-process. */
	async doctor(): Promise<AphrodyDoctorResult | null> {
		const res = await this.run<AphrodyDoctorResult>(["doctor", "--json"]);
		return res.kind === "exit" && res.ok ? (res.data ?? null) : null;
	}

	/** Query the canonical Shenron RAG bridge. */
	async ragSearch(
		query: string,
		options: { limit?: number; kind?: string } = {}
	): Promise<AphrodyRagHit[]> {
		const lib = loadNativeLibrary();
		if (!lib) return [];
		const ptr = lib.symbols.shenron_rag_search(
			cstr(query),
			Math.max(1, Math.min(options.limit ?? 5, 100)),
			options.kind ? cstr(options.kind) : null
		);
		if (!ptr) return [];
		try {
			const envelope = JSON.parse(new CString(ptr).toString());
			if (envelope.code !== 0 || typeof envelope.stdout !== "string") return [];
			const rows = JSON.parse(envelope.stdout.trim());
			if (!Array.isArray(rows)) return [];
			const ranked = rows.map((row: any) => ({
				title: row.title || "Sans titre",
				url: row.url || "",
				snippet: row.snippet || "",
				score: typeof row.score === "number" ? row.score : 0,
				kind: row.kind || "document",
				sourceId: row.sourceId || undefined,
				lang: row.lang || undefined,
				content: row.content || row.snippet || "",
			}));
			const scores = ranked.map((row: AphrodyRagHit) => row.score);
			const min = Math.min(...scores);
			const max = Math.max(...scores);
			return ranked.map((row: AphrodyRagHit) => ({
				...row,
				score: max > min ? 0.4 + (0.6 * (row.score - min)) / (max - min) : 1,
			}));
		} catch {
			return [];
		} finally {
			lib.symbols.shenron_string_free(ptr);
		}
	}

	/** Fetch RAG index corpus statistics in-process. */
	async ragStats(): Promise<AphrodyRagStats | null> {
		const lib = loadNativeLibrary();
		if (!lib) return null;
		const ptr = lib.symbols.shenron_rag_stats();
		if (!ptr) return null;
		try {
			const envelope = JSON.parse(new CString(ptr).toString());
			if (envelope.code !== 0 || typeof envelope.stdout !== "string") return null;
			const data = JSON.parse(envelope.stdout.trim());
			const count = data.total_chunks || 0;
			return {
				chunks: count,
				vectors: 0,
				sources: Array.isArray(data.kinds)
					? data.kinds.map((k: any) => ({
							sourceId: k.kind || "databook",
							kind: k.kind || "databook",
							count: k.c || 0,
						}))
					: [],
			};
		} catch {
			return null;
		} finally {
			lib.symbols.shenron_string_free(ptr);
		}
	}

	/** Return only the sanitized authentication presence flags. */
	authStatus(): ShenronAuthStatus | null {
		const lib = loadNativeLibrary();
		if (!lib) return null;
		const ptr = lib.symbols.shenron_auth_status();
		if (!ptr) return null;
		try {
			const envelope = JSON.parse(new CString(ptr).toString());
			if (envelope.code !== 0 || typeof envelope.stdout !== "string") return null;
			const status = JSON.parse(envelope.stdout.trim());
			if (
				typeof status.configured !== "boolean" ||
				typeof status.admin_credentials_present !== "boolean"
			) {
				return null;
			}
			return {
				configured: status.configured,
				adminCredentialsPresent: status.admin_credentials_present,
			};
		} catch {
			return null;
		} finally {
			lib.symbols.shenron_string_free(ptr);
		}
	}

	/** Fetch sovereign persona prompt. */
	async personaPrompt(): Promise<string | null> {
		const lib = loadNativeLibrary();
		return lib ? lib.symbols.shenron_persona_prompt().toString() : null;
	}
}

/** Global singleton instance */
export const aphrodyNative = new AphrodyNativeClient();
