// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPublicDocument } from "../scripts/openapi";

const PKG = join(import.meta.dir, "..");
const COMMITTED = join(PKG, "openapi", "public.json");

interface Doc {
	openapi: string;
	paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
	components: { schemas: Record<string, unknown> };
}

function runCheck(dir: string) {
	return Bun.spawnSync([process.execPath, join(dir, "scripts", "openapi.ts"), "--check"], {
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("openapi/public.json", () => {
	test("committed document equals the generated one", () => {
		expect(readFileSync(COMMITTED, "utf8").replace(/\r\n/g, "\n")).toBe(renderPublicDocument());
	});

	test("OpenAPI 3.1, absolute paths (honojs/middleware#952), components from .meta ids", () => {
		const doc = JSON.parse(renderPublicDocument()) as Doc;
		expect(doc.openapi).toBe("3.1.0");
		expect(Object.keys(doc.paths)).toEqual([
			"/api/public/openapi.json",
			"/api/public/wiki/categories",
			"/api/public/wiki/{category}",
			"/api/public/wiki/{category}/{idOrSlug}",
		]);
		for (const path of Object.keys(doc.paths)) expect(path.startsWith("/api/public/")).toBe(true);
		for (const id of [
			"ErrorEnvelope",
			"ApiErrorCode",
			"WikiCategoriesResponse",
			"WikiCategorySummary",
			"WikiCategoryName",
			"WikiListResponse",
			"WikiEntity",
		]) {
			expect(Object.keys(doc.components.schemas)).toContain(id);
		}
		const categories = JSON.stringify(doc.paths["/api/public/wiki/categories"]);
		expect(categories).toContain("#/components/schemas/WikiCategoriesResponse");
		expect(categories).toContain("#/components/schemas/ErrorEnvelope");
	});

	test("stable regardless of enabled groups and repeated renders", () => {
		expect(renderPublicDocument()).toBe(renderPublicDocument());
	});

	test("--check exits 0 on the package and 1 after a schema edit in a temp copy", () => {
		const ok = runCheck(PKG);
		expect(ok.exitCode).toBe(0);

		// The copy lives inside the package so bare imports resolve through the workspace.
		const dir = mkdtempSync(join(PKG, ".drift-"));
		try {
			for (const part of ["src", "scripts", "openapi"]) {
				cpSync(join(PKG, part), join(dir, part), { recursive: true });
			}
			const same = runCheck(dir);
			expect(same.exitCode).toBe(0);
			const schemas = join(dir, "src", "contract", "schemas.ts");
			const source = readFileSync(schemas, "utf8");
			const edited = source.replace(
				"categories: z.array(WikiCategorySummary)",
				"categories: z.array(WikiCategorySummary), generatedAt: z.string()"
			);
			expect(edited).not.toBe(source);
			writeFileSync(schemas, edited);
			const drift = runCheck(dir);
			expect(drift.exitCode).toBe(1);
			expect(drift.stderr.toString()).toContain("out of date");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);
});
