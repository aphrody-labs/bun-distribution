// SPDX-License-Identifier: Apache-2.0
/**
 * @shenron/pipeline/aphrody/cli — thin wrappers over the `aphrody` binary (runtime class `bun`,
 * scripts only). Every call is a `Bun.spawn` with a timeout; the outcome is always a
 * classified {@link CliResult}, never a throw and never a fabricated success.
 *
 * Only commands with JSON output are wrapped (`doctor --json`, `git inspect`);
 * `translate` and `notify` print free text and are intentionally not wrapped.
 */

export const DEFAULT_APHRODY_CLI_TIMEOUT_MS = 30_000;

export interface AphrodyCliOptions {
	/** Binary to run. Defaults to `APHRODY_BIN`, then `aphrody` on PATH. */
	bin?: string;
	/** Kill the process after this many milliseconds (default 30 s). */
	timeoutMs?: number;
	/** Parse stdout as JSON; a parse failure yields `invalid_json`. */
	json?: boolean;
	/** Working directory of the child process. */
	cwd?: string;
}

interface CliOutput {
	stdout: string;
	stderr: string;
	durationMs: number;
}

/** Classified result of one CLI call. */
export type CliResult<T = unknown> =
	| { kind: "not_found"; bin: string; message: string }
	| ({ kind: "exit"; ok: true; code: 0; data: T | undefined } & CliOutput)
	| ({ kind: "exit"; ok: false; code: number; data?: undefined } & CliOutput)
	| ({ kind: "timeout"; timeoutMs: number } & CliOutput)
	| ({ kind: "invalid_json"; code: number; error: string } & CliOutput);

export interface AphrodyDoctorResult {
	verdict?: string;
	agentWorkspace?: { path: string; charCount: number };
	[key: string]: unknown;
}

export interface AphrodyGitInspectResult {
	head?: string;
	[key: string]: unknown;
}

function resolveBin(bin: string | undefined): string | null {
	const wanted = bin ?? (process.env.APHRODY_BIN?.trim() || "aphrody");
	if (wanted.includes("/") || wanted.includes("\\")) {
		return wanted;
	}
	return Bun.which(wanted);
}

/** Runs `aphrody <args>` and classifies the outcome. */
export async function runAphrodyCli<T = unknown>(
	args: readonly string[],
	options: AphrodyCliOptions = {}
): Promise<CliResult<T>> {
	const requested = options.bin ?? (process.env.APHRODY_BIN?.trim() || "aphrody");
	const bin = resolveBin(options.bin);
	if (!bin) {
		return { kind: "not_found", bin: requested, message: `${requested} introuvable sur le PATH` };
	}
	const timeoutMs = options.timeoutMs ?? DEFAULT_APHRODY_CLI_TIMEOUT_MS;
	const started = performance.now();
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([bin, ...args], {
			cwd: options.cwd,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (error) {
		return {
			kind: "not_found",
			bin,
			message: error instanceof Error ? error.message : String(error),
		};
	}

	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const drain = async (stream: ReadableStream<Uint8Array>, sink: string[]) => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) sink.push(decoder.decode(chunk, { stream: true }));
		sink.push(decoder.decode());
	};
	const completed = Promise.all([
		drain(proc.stdout as ReadableStream<Uint8Array>, stdoutChunks),
		drain(proc.stderr as ReadableStream<Uint8Array>, stderrChunks),
		proc.exited,
	]).then(([, , code]) => code);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	const outcome = await Promise.race([completed, expired]).finally(() => clearTimeout(timer));
	const out = (): CliOutput => ({
		stdout: stdoutChunks.join(""),
		stderr: stderrChunks.join(""),
		durationMs: Math.round(performance.now() - started),
	});
	if (outcome === "timeout") {
		killTree(proc);
		completed.catch(() => undefined);
		return { kind: "timeout", timeoutMs, ...out() };
	}
	const code = outcome;
	if (code !== 0) return { kind: "exit", ok: false, code, ...out() };
	const output = out();
	if (!options.json) return { kind: "exit", ok: true, code: 0, data: undefined, ...output };
	try {
		return { kind: "exit", ok: true, code: 0, data: JSON.parse(output.stdout) as T, ...output };
	} catch (error) {
		return {
			kind: "invalid_json",
			code,
			error: error instanceof Error ? error.message : String(error),
			...output,
		};
	}
}

/** Kills the child and, on Windows, its descendants (a `.cmd` shim spawns a grandchild). */
function killTree(proc: { pid: number; kill(): void }): void {
	if (process.platform === "win32") {
		try {
			Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
				stdout: "ignore",
				stderr: "ignore",
			});
		} catch {
			// taskkill unavailable: fall back to killing the direct child.
		}
	}
	try {
		proc.kill();
	} catch {
		// Already exited.
	}
}

/** `aphrody doctor --json`. */
export function aphrodyDoctor(
	options: Omit<AphrodyCliOptions, "json"> = {}
): Promise<CliResult<AphrodyDoctorResult>> {
	return runAphrodyCli<AphrodyDoctorResult>(["doctor", "--json"], { ...options, json: true });
}

/** `aphrody git inspect <repo>` (pure-Rust gix inspection). */
export function aphrodyGitInspect(
	repoPath: string = process.cwd(),
	options: Omit<AphrodyCliOptions, "json"> = {}
): Promise<CliResult<AphrodyGitInspectResult>> {
	return runAphrodyCli<AphrodyGitInspectResult>(["git", "inspect", repoPath], {
		...options,
		json: true,
	});
}
