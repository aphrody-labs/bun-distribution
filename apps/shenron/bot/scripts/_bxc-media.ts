import os from "node:os";
import path from "node:path";

import type { Player } from "./_embed-liveness";

export type DirectStream = {
	type: "hls" | "mp4";
	url: string;
	headers: Record<string, string>;
	provider: string;
};

export type BxcResult<T> =
	| { ok: true; value: T; stderr: string }
	| { ok: false; error: string; stderr: string };

export type BxcLaunch = {
	command: string[];
	cwd?: string;
};

type BxcResolverOptions = {
	env?: NodeJS.ProcessEnv;
	execPath?: string;
	homeDir?: string;
	which?: (executable: string, pathValue: string) => string | null;
	exists?: (filePath: string) => Promise<boolean>;
};

type SpawnBxcProcess = (
	command: string[],
	options: {
		cwd?: string;
		env: NodeJS.ProcessEnv;
		stdout: "pipe";
		stderr: "pipe";
	}
) => ReturnType<typeof Bun.spawn>;

const ipRefusalPattern =
	/(?:HTTP\s*(?:403|407|429)|forbidden|access denied|captcha|geo.?block|ip.?block|rate.?limit)/i;

export function isIpRefusal(message: string): boolean {
	return ipRefusalPattern.test(message);
}

export function sanitizeBxcDiagnostic(message: string): string {
	const sanitized = message
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
		.replace(
			/\b(api[-_]?key|access[-_]?token|token|secret|password|passwd|authorization|cookie|session)\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1$2[REDACTED]"
		)
		.replace(
			/([?&](?:api[-_]?key|access[-_]?token|token|secret|password|signature|session)=)[^&#\s]+/gi,
			"$1[REDACTED]"
		)
		.replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
		.replace(/[\r\n\t]+/g, " | ")
		.replace(/\s{2,}/g, " ")
		.trim();
	if (sanitized.length <= 480) return sanitized;
	return `${sanitized.slice(0, 238)} … ${sanitized.slice(-238)}`;
}

export async function resolveBxcLaunch(
	args: string[],
	options: BxcResolverOptions = {}
): Promise<BxcLaunch | null> {
	const env = options.env ?? process.env;
	const configuredBinary = env.BXC_BIN?.trim();
	if (configuredBinary) return { command: [configuredBinary, ...args] };

	const which =
		options.which ??
		((executable: string, pathValue: string) => Bun.which(executable, { PATH: pathValue }));
	const installedBinary = which("bxc", env.PATH ?? "");
	if (installedBinary) return { command: [installedBinary, ...args] };

	const bxcDir = env.BXC_DIR?.trim() || path.join(options.homeDir ?? os.homedir(), "bxc");
	const exists = options.exists ?? ((filePath: string) => Bun.file(filePath).exists());
	for (const relativePath of ["src/cli/index.ts", "bin/bxc.mjs"]) {
		const sourceCli = path.join(bxcDir, relativePath);
		if (await exists(sourceCli)) {
			return {
				command: [options.execPath ?? process.execPath, sourceCli, ...args],
				cwd: bxcDir,
			};
		}
	}
	return null;
}

export async function resolveBxcSourceScript(
	script: string,
	args: string[],
	options: BxcResolverOptions = {}
): Promise<BxcLaunch | null> {
	if (!/^[a-z0-9-]+\.ts$/i.test(script)) return null;
	const env = options.env ?? process.env;
	const bxcDir = env.BXC_DIR?.trim() || path.join(options.homeDir ?? os.homedir(), "bxc");
	const sourceScript = path.join(bxcDir, "scripts", script);
	const exists = options.exists ?? ((filePath: string) => Bun.file(filePath).exists());
	if (!(await exists(sourceScript))) return null;
	return {
		command: [options.execPath ?? process.execPath, sourceScript, ...args],
		cwd: bxcDir,
	};
}

function proxyPool(): string[] {
	return (process.env.SHENRON_MEDIA_PROXIES ?? "")
		.split(/[\n,]+/)
		.map((value) => value.trim())
		.filter(Boolean);
}

export function parseBxcJsonOutput<T>(output: string): T {
	const trimmed = output.trim();
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		// Some scripts print progress lines before a compact final payload.
	}
	const lines = trimmed.split("\n").filter(Boolean);
	for (let index = lines.length - 1; index >= 0; index--) {
		try {
			return JSON.parse(lines[index]) as T;
		} catch {
			// BXC writes progress before the final JSON value.
		}
	}
	throw new Error("BXC produced no JSON output");
}

export async function runBxcLaunch<T>(
	launch: BxcLaunch,
	timeoutMs: number,
	proxy?: string,
	spawn: SpawnBxcProcess = (command, options) => Bun.spawn(command, options)
): Promise<BxcResult<T>> {
	const env = proxy
		? {
				...process.env,
				BXC_PROXY: proxy,
				HTTP_PROXY: proxy,
				HTTPS_PROXY: proxy,
			}
		: process.env;
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = spawn(launch.command, {
			...(launch.cwd ? { cwd: launch.cwd } : {}),
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (error) {
		const diagnostic = sanitizeBxcDiagnostic(String(error));
		return {
			ok: false,
			error: `Unable to start BXC${diagnostic ? `: ${diagnostic}` : ""}`,
			stderr: diagnostic,
		};
	}
	const timer = setTimeout(() => proc.kill(), timeoutMs);
	let stdout: string;
	let stderr: string;
	let exitCode: number;
	try {
		[stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
	} catch (error) {
		const diagnostic = sanitizeBxcDiagnostic(String(error));
		return {
			ok: false,
			error: `BXC process failed${diagnostic ? `: ${diagnostic}` : ""}`,
			stderr: diagnostic,
		};
	} finally {
		clearTimeout(timer);
	}
	const safeStderr = sanitizeBxcDiagnostic(stderr);
	if (exitCode !== 0) {
		const diagnostic = safeStderr || sanitizeBxcDiagnostic(stdout);
		return {
			ok: false,
			error: `BXC exited with code ${exitCode}${diagnostic ? `: ${diagnostic}` : ""}`,
			stderr: safeStderr,
		};
	}
	try {
		return {
			ok: true,
			value: parseBxcJsonOutput<T>(stdout),
			stderr: safeStderr,
		};
	} catch (error) {
		const diagnostic = safeStderr || sanitizeBxcDiagnostic(String(error));
		return {
			ok: false,
			error: `BXC returned invalid JSON${diagnostic ? `: ${diagnostic}` : ""}`,
			stderr: safeStderr,
		};
	}
}

async function runCommand<T>(launch: BxcLaunch, timeoutMs = 60_000): Promise<BxcResult<T>> {
	let result = await runBxcLaunch<T>(launch, timeoutMs);
	if (result.ok || !isIpRefusal(`${result.error}\n${result.stderr}`)) return result;

	for (const proxy of proxyPool()) {
		result = await runBxcLaunch<T>(launch, timeoutMs, proxy);
		if (result.ok) return result;
		if (!isIpRefusal(`${result.error}\n${result.stderr}`)) return result;
	}
	return result;
}

async function runBxc<T>(args: string[], timeoutMs = 60_000): Promise<BxcResult<T>> {
	const launch = await resolveBxcLaunch(args);
	if (!launch) {
		return {
			ok: false,
			error: "BXC executable not found on PATH and no source CLI is available",
			stderr: "",
		};
	}
	return runCommand<T>(launch, timeoutMs);
}

async function runBxcSourceScript<T>(
	script: string,
	args: string[],
	timeoutMs = 60_000
): Promise<BxcResult<T>> {
	const launch = await resolveBxcSourceScript(script, args);
	if (!launch) {
		return {
			ok: false,
			error: `BXC source helper scripts/${script} is unavailable`,
			stderr: "",
		};
	}
	return runCommand<T>(launch, timeoutMs);
}

async function refreshPlayers(args: string[]): Promise<BxcResult<Player[]>> {
	const result = await runBxcSourceScript<Player[] | { error?: string }>(
		"refresh-embed-players.ts",
		args
	);
	if (!result.ok) return result;
	if (!Array.isArray(result.value)) {
		return {
			ok: false,
			error: result.value.error ?? "BXC returned an invalid player payload",
			stderr: result.stderr,
		};
	}
	return { ok: true, value: result.value, stderr: result.stderr };
}

export function refreshEpisodePlayers(
	series: string,
	number: number
): Promise<BxcResult<Player[]>> {
	return refreshPlayers(["episode", series, String(number)]);
}

export function refreshMoviePlayers(id: number): Promise<BxcResult<Player[]>> {
	return refreshPlayers(["movie", String(id)]);
}

export async function resolvePlayer(player: Player): Promise<BxcResult<DirectStream>> {
	const result = await runBxc<{
		type?: string;
		url?: string;
		headers?: Record<string, string>;
		provider?: string;
		error?: string | null;
	}>(["voiranime", "resolve", player.embedUrl, "--profile", "http"]);
	if (!result.ok) return result;
	const value = result.value;
	if (!value.url || (value.type !== "hls" && value.type !== "mp4")) {
		return {
			ok: false,
			error: value.error ?? "BXC found no direct HLS/MP4 stream",
			stderr: result.stderr,
		};
	}
	return {
		ok: true,
		value: {
			type: value.type,
			url: value.url,
			headers: value.headers ?? {},
			provider: value.provider ?? player.provider,
		},
		stderr: result.stderr,
	};
}

export function resolveEpisodeStreams(
	series: string,
	number: number
): Promise<BxcResult<Partial<Record<"vf" | "vostfr", DirectStream>>>> {
	return runBxcSourceScript<
		| Partial<Record<"vf" | "vostfr", DirectStream>>
		| {
				variants?: Partial<Record<"vf" | "vostfr", DirectStream>>;
				error?: string;
		  }
	>("resolve-episode.ts", [series, String(number)]).then((result) => {
		if (!result.ok) return result;
		if ("variants" in result.value) {
			if (result.value.error && !result.value.variants) {
				return { ok: false, error: result.value.error, stderr: result.stderr };
			}
			return { ok: true, value: result.value.variants ?? {}, stderr: result.stderr };
		}
		return { ok: true, value: result.value, stderr: result.stderr };
	});
}
