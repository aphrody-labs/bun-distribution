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
	const child = Bun.spawn([resolveGoogleBinary(), ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || `aphrody-google ${args[0]} failed (${exitCode})`);
	}
	const output = stdout.trim();
	return (output ? JSON.parse(output) : undefined) as T;
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
	const child = Bun.spawn([resolveGoogleBinary(), "generate-stream", "--model", model], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = child.stdout.getReader();
	const abort = () => child.kill();
	const exitCode = () => child.exited;
	if (signal?.aborted) abort();
	signal?.addEventListener("abort", abort, { once: true });
	return new ReadableStream<string>({
		start() {
			child.stdin.write(prompt);
			void child.stdin.end();
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
