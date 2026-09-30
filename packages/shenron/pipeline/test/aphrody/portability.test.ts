// SPDX-License-Identifier: Apache-2.0
/** Root and server subpaths stay free of Bun-only natives (B16, runtime class `server`). */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "..", "src");
const FORBIDDEN = /from\s+["'](?:bun:ffi|bun:sqlite|sharp|bun)["']|import\(\s*["'](?:bun:ffi|sharp)["']\s*\)|\bdlopen\b/;

describe("portability", () => {
	for (const file of ["index.ts", "aphrody/compute.ts", "aphrody/shenron-embeddings.ts", "aphrody/web.ts"]) {
		it(`${file} imports no Bun-native module`, () => {
			const text = readFileSync(join(SRC, file), "utf8");
			expect(FORBIDDEN.test(text)).toBe(false);
			expect(/\bBun\./.test(text)).toBe(false);
		});
	}

	it("a2a never imports an application module", () => {
		for (const file of ["aphrody/a2a.ts", "aphrody/a2a-probes.ts"]) {
			const text = readFileSync(join(SRC, file), "latin1");
			expect(/(?:from\s+|import\(\s*)["'][^"']*apps\//.test(text)).toBe(false);
			expect(/bun:ffi|from\s+["']sharp["']/.test(text)).toBe(false);
		}
	});

	it("root bundles for node without bun:ffi, bun:sqlite, sharp or A2A code", async () => {
		const result = await Bun.build({ entrypoints: [join(SRC, "index.ts")], target: "node" });
		expect(result.success).toBe(true);
		const code = await result.outputs[0]!.text();
		expect(code).not.toMatch(/bun:ffi|bun:sqlite|["']sharp["']|ShenronA2AHub|\.coord/);
	});
});
