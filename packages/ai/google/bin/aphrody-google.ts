#!/usr/bin/env bun
/** Thin Bun entrypoint: the Rust binary remains the single authority. */
import { join } from "node:path";

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
