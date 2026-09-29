// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const explicitEndpoint = process.env.APHRODY_WEB_TEST_CDP_URL;
if (explicitEndpoint) {
	process.env.APHRODY_BROWSER_CDP_URL = explicitEndpoint;
} else {
	const binary = process.env.APHRODY_WEB_BIN ?? resolve(
		import.meta.dir,
		`../../../../target/debug/aphrody-web${process.platform === "win32" ? ".exe" : ""}`,
	);
	if (!existsSync(binary)) {
		throw new Error(`Build the Rust aphrody-web binary before browser tests: ${binary}`);
	}

	const reservation = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});
	const port = reservation.port;
	reservation.stop(true);

	const server = Bun.spawn([binary, "launch", "--host", "127.0.0.1", "--port", String(port)], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "inherit",
		env: { ...process.env, OBSCURA_ALLOW_PRIVATE_NETWORK: "1" },
	});
	const reader = server.stdout.getReader();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const first = await Promise.race([
			reader.read(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error("Rust browser test server did not start")), 10_000);
			}),
		]);
		const endpoint = new TextDecoder().decode(first.value).trim();
		if (first.done || !endpoint.startsWith(`ws://127.0.0.1:${port}/devtools/browser`)) {
			throw new Error(`Rust browser test server returned an invalid endpoint: ${endpoint}`);
		}
		process.env.APHRODY_BROWSER_CDP_URL = endpoint;
		server.unref();
		process.on("exit", () => server.kill());
	} catch (error) {
		server.kill();
		throw error;
	} finally {
		if (timeout) clearTimeout(timeout);
		reader.releaseLock();
	}
}
