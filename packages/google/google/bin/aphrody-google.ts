#!/usr/bin/env bun
/** Canonical Google CLI: Bun owns Drive sync; other commands use the Rust binary. */
import { join } from "node:path";

if (Bun.argv[2] === "drive") {
	try {
		const { runDriveCli } = await import("../src/drive-cli.ts");
		await runDriveCli(Bun.argv.slice(3));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
	process.exit();
}

if (Bun.argv[2] === "fonts") {
	const args = Bun.argv.slice(4);
	const opt = (name: string, fallback: string) => {
		const i = args.indexOf(`--${name}`);
		return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
	};
	if (Bun.argv[3] !== "serve") {
		console.error("usage: aphrody-google fonts serve [--port 8796] [--cache <dir>] [--origin https://cdn.aphrody.com] [--all-families]");
		process.exit(2);
	}
	const { serveFontsProxy } = await import("../src/fonts-proxy.ts");
	const server = serveFontsProxy({
		port: Number(opt("port", Bun.env.FONTS_PROXY_PORT ?? "8796")),
		cacheDir: opt("cache", Bun.env.FONTS_PROXY_CACHE ?? "/srv/aphrody-cdn/google"),
		origin: opt("origin", Bun.env.FONTS_PROXY_ORIGIN ?? "https://cdn.aphrody.com"),
		families: args.includes("--all-families") ? null : undefined,
	});
	console.log(`aphrody-fonts-proxy on ${server.url}`);
	await new Promise(() => {});
}

async function resolveBinary(): Promise<string> {
	const configured = Bun.env.APHRODY_GOOGLE_BIN;
	if (configured && await Bun.file(configured).exists()) return configured;

	const onPath = Bun.which("aphrody-google") ?? Bun.which("google");
	if (onPath) return onPath;

	const home = Bun.env.USERPROFILE ?? Bun.env.HOME;
	if (home) {
		for (const name of ["aphrody-google.exe", "aphrody-google", "google.exe", "google"]) {
			const candidate = join(home, ".aphrody", "bin", name);
			if (await Bun.file(candidate).exists()) return candidate;
		}
	}

	throw new Error("aphrody-google binary not found; install it in ~/.aphrody/bin or set APHRODY_GOOGLE_BIN");
}

const binary = await resolveBinary();
const proc = Bun.spawn([binary, ...Bun.argv.slice(2)], {
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
process.exit(await proc.exited);
