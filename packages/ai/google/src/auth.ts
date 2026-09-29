import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";

export interface GoogleProfile {
	name?: string;
	email?: string;
	picture?: string;
}

export interface GoogleModel {
	name?: string;
	displayName?: string;
	description?: string;
	capabilities?: unknown;
}

export function resolveGoogleBinary(): string {
	const configured = Bun.env.APHRODY_GOOGLE_BIN;
	if (configured) return configured;
	const binary = Bun.which("aphrody-google") ?? Bun.which("google");
	if (!binary) throw new Error("aphrody-google binary not found; set APHRODY_GOOGLE_BIN or add it to PATH");
	return binary;
}

async function invoke<T>(...args: string[]): Promise<T> {
	const child = spawn(resolveGoogleBinary(), args, { stdio: ["ignore", "pipe", "pipe"] });
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	const exitCode = await new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 1));
	});
	if (exitCode !== 0) {
		const message = Buffer.concat(stderr).toString("utf8").trim();
		throw new Error(message || `aphrody-google ${args[0]} failed (${exitCode})`);
	}
	const output = Buffer.concat(stdout).toString("utf8").trim();
	return (output ? JSON.parse(output) : undefined) as T;
}

function nativeStdio(...args: string[]): ChildProcess {
	return spawn(resolveGoogleBinary(), args, { stdio: ["ignore", "pipe", "pipe"] });
}

/** Run Google OAuth PKCE login and persist the result in the OS credential store. */
export function googleLogin(): Promise<void> {
	return invoke<void>("login");
}

/** Check credential availability without returning credential material. */
export function googleAuthStatus(): Promise<string> {
	return invoke<void>("auth-status").then(() => "available");
}

/** Return the signed-in account's non-secret OpenID profile. */
export function googleWhoami(): Promise<GoogleProfile> {
	return invoke<GoogleProfile>("whoami");
}

/** List Gemini models exposed to the signed-in account. */
export function googleModels(): Promise<GoogleModel[]> {
	return invoke<{ models: GoogleModel[] }>("models").then((result) => result.models ?? []);
}

/** Generate one Gemini response using the signed-in account. */
export function googleGenerate(prompt: string, model?: string): Promise<unknown> {
	const args = ["generate", "--prompt", prompt];
	if (model) args.push("--model", model);
	return invoke<unknown>(...args);
}

/** Run Gemini generateContent through the OAuth-backed native SDK. */
export function googleGenerateStream(
	prompt: string,
	model = "gemini-2.5-flash",
	signal?: AbortSignal,
): ReadableStream<string> {
	const child = nativeStdio("generate-stream", "--model", model);
	const output = child.stdout;
	const input = child.stdin;
	if (!output || !input) {
		child.kill();
		throw new Error("aphrody-google did not expose its input/output streams");
	}
	const source = Readable.toWeb(output) as ReadableStream<Uint8Array>;
	const reader = source.getReader();
	const abort = () => child.kill();
	let processExit: Promise<number> | undefined;
	const exitCode = () => processExit ??= new Promise<number>((resolve, reject) => {
		child.once("close", (code) => resolve(code ?? 1));
		child.once("error", reject);
	});
	if (signal?.aborted) abort();
	signal?.addEventListener("abort", abort, { once: true });
	return new ReadableStream<string>({
		start() {
			input.end(prompt);
		},
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					const code = await exitCode();
					if (code !== 0) throw new Error(`aphrody-google generate-stream failed (${code})`);
					signal?.removeEventListener("abort", abort);
					controller.close();
					return;
				}
				controller.enqueue(new TextDecoder().decode(value, { stream: true }));
			} catch (error) {
				signal?.removeEventListener("abort", abort);
				controller.error(error);
			}
		},
		async cancel(reason) {
			signal?.removeEventListener("abort", abort);
			child.kill();
			await Promise.allSettled([reader.cancel(reason), exitCode()]);
		},
	});
}
