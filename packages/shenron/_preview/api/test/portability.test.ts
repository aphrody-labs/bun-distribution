// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkNoEscapingImports, checkPackageRuntimes, stripNonCode } from "@shenron/config/guards";

const PKG_DIR = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as {
	exports: Record<string, string>;
	shenron: { runtime: Record<string, string> };
	sideEffects: boolean;
	private: boolean;
};

const RUNTIME: Record<string, string> = {
	"./contract": "pure",
	"./client": "pure",
	"./http": "pure",
	"./server": "hono",
	"./next": "server",
	"./openapi.json": "json",
};

function source(key: string): string {
	return stripNonCode(readFileSync(join(PKG_DIR, manifest.exports[key] ?? "missing"), "utf8"));
}

describe("@shenron/api manifest", () => {
	test("exports and runtime classes of docs/STACK.md §3.6, no root export", () => {
		expect(manifest.exports).not.toHaveProperty(".");
		expect(Object.keys(manifest.exports).toSorted()).toEqual(Object.keys(RUNTIME).toSorted());
		expect(manifest.shenron.runtime).toEqual(RUNTIME);
		expect(manifest.private).toBe(true);
		expect(manifest.sideEffects).toBe(false);
	});

	for (const key of ["./contract", "./client", "./http"]) {
		test(`${key}: pure (no hono, node:, bun:, process, Bun., next)`, async () => {
			const code = source(key);
			expect(code).not.toMatch(/from\s+["'](?:node:|bun(?::|["'])|hono|@hono\/)/);
			expect(code).not.toMatch(/\bprocess\.|\bBun\.|\bimport\.meta\b/);
			expect(code).not.toMatch(/["']next(?:\/|["'])/);
			const mod = (await import(join(PKG_DIR, manifest.exports[key]!))) as Record<string, unknown>;
			expect(Object.keys(mod).length).toBeGreaterThan(0);
		});
	}

	test("./server and ./next never import next, server-only, DI containers or discord.js", () => {
		for (const key of ["./server", "./next"]) {
			const code = source(key);
			expect(code).not.toMatch(
				/["'](?:next(?:\/[\w-]+)?|server-only|tsyringe|@aphrody\/di|discord\.js)["']/
			);
			expect(code).not.toContain("container.resolve");
			expect(code).not.toMatch(/@shenron\/ai\b/);
		}
	});

	test("./openapi.json is valid JSON", () => {
		const doc = JSON.parse(
			readFileSync(join(PKG_DIR, manifest.exports["./openapi.json"]!), "utf8")
		);
		expect(doc.openapi).toBe("3.1.0");
	});

	test("runtime-class guard and escaping-import guard are clean", async () => {
		expect(await checkPackageRuntimes(PKG_DIR)).toEqual([]);
		expect(await checkNoEscapingImports(PKG_DIR)).toEqual([]);
	}, 60_000);
});
