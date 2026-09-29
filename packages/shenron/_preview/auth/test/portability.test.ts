import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	checkBrowserBundles,
	checkEmptyEnvImports,
	checkNoEscapingImports,
	checkPackageRuntimes,
	listExportEntries,
} from "@shenron/config/guards";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));

/** docs/STACK.md §3.3. */
const EXPECTED: Record<string, string> = {
	".": "server",
	"./origins": "pure",
	"./a2a": "server",
	"./crypto": "server",
	"./tokens": "server",
	"./acting-user": "server",
	"./staff": "pure",
	"./ports": "pure",
	"./guards": "server",
	"./options": "server",
	"./policy": "pure",
	"./agent-keys": "server",
	"./next": "next",
	"./hono": "hono",
	"./client": "react",
};

const sources = () =>
	readdirSync(join(pkgDir, "src"))
		.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
		.map((f) => ({ file: f, code: readFileSync(join(pkgDir, "src", f), "utf8") }));

describe("@shenron/auth portability", () => {
	test("every subpath is exported with its runtime class", () => {
		const entries: Record<string, string | null> = Object.fromEntries(
			listExportEntries(pkgDir).map((e) => [e.subpath, e.runtime])
		);
		expect(entries).toEqual(EXPECTED);
	});

	test("runtime classes hold", async () => {
		expect(await checkPackageRuntimes(pkgDir)).toEqual([]);
	});

	test("no @/ alias, no escaping relative import, no env read at load", async () => {
		expect(await checkNoEscapingImports(pkgDir)).toEqual([]);
		expect(await checkEmptyEnvImports(pkgDir)).toEqual([]);
	});

	test("never imports @shenron/db, server-only or an app env module", () => {
		for (const { file, code } of sources()) {
			expect({ file, db: /["']@shenron\/db/.test(code) }).toEqual({ file, db: false });
			expect({ file, so: /["']server-only["']/.test(code) }).toEqual({ file, so: false });
			expect({ file, env: /["'](?:@|~)\/lib\/env["']/.test(code) }).toEqual({ file, env: false });
		}
	});

	test("pure and react subpaths bundle for the browser (./client, ./policy, ./staff, ./ports, ./origins)", async () => {
		expect(await checkBrowserBundles(pkgDir)).toEqual([]);
	}, 180_000);
});
