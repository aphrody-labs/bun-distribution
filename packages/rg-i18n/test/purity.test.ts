import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIRECTORY = join(import.meta.dir, "..", "src");

describe("pureté du noyau", () => {
	test("ne dépend ni d'un framework, ni du DOM, ni d'une base", () => {
		const source = readdirSync(SOURCE_DIRECTORY)
			.filter((file) => file.endsWith(".ts"))
			.map((file) => readFileSync(join(SOURCE_DIRECTORY, file), "utf8"))
			.join("\n");

		expect(source).not.toMatch(/from\s+["'](?:react|next|@rosegriffon\/db|@supabase\/)/);
		expect(source).not.toMatch(
			/\b(?:window|document|localStorage|sessionStorage)\s*(?:\.\s*[A-Za-z_$]|\[\s*["'])/
		);
	});
});
