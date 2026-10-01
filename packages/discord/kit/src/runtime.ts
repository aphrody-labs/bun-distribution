// SPDX-License-Identifier: Apache-2.0
import process from "node:process";

/**
 * Détermine si le code s'exécute à l'intérieur d'un binaire standalone compilé via `bun build --compile`.
 */
export function isCompiledBinary(): boolean {
	if (typeof import.meta.url === "string" && import.meta.url.includes("$bunfs")) {
		return true;
	}
	const exec = process.execPath ?? "";
	return !exec.endsWith("/bun") && !exec.endsWith("\\bun.exe") && !exec.endsWith("/bun.exe");
}

/**
 * Métadonnées d'exécution du bot (mode interprété vs binaire autonome, architecture, runtime).
 */
export interface BotRuntimeInfo {
	isCompiled: boolean;
	bunVersion: string;
	platform: NodeJS.Platform;
	arch: string;
	execPath: string;
}

export function getBotRuntimeInfo(): BotRuntimeInfo {
	const bunGlobal = (globalThis as unknown as { Bun?: { version?: string } }).Bun;
	return {
		isCompiled: isCompiledBinary(),
		bunVersion: bunGlobal?.version ?? process.versions.node ?? "unknown",
		platform: process.platform,
		arch: process.arch,
		execPath: process.execPath,
	};
}
