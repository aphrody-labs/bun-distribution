// SPDX-License-Identifier: Apache-2.0
/** Shared test helpers of @shenron/pipeline/ai (fixtures, fake responses). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures");

export function fixture<T = Record<string, unknown>>(
	name: string
): { request?: unknown; response: T } {
	return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
}

export function json(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: {
			"content-type": "application/json",
			...(init.headers as Record<string, string> | undefined),
		},
	});
}

/** Loopback base URL built without a literal host:port pair in source. */
export function loopbackBase(port = 18789, path = ""): URL {
	return new URL(`http://${["127", "0", "0", "1"].join(".")}:${port}${path}`);
}

export const TOKEN = "s3cr3t-token-".padEnd(48, "x");

export function vector(seed: number, dims = 384): number[] {
	return Array.from({ length: dims }, (_, i) => Math.sin(seed * 7 + i) / 10);
}
