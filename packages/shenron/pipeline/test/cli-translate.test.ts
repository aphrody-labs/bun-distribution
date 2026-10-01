// SPDX-License-Identifier: Apache-2.0
/**
 * The unified translation command must expose a safe Bun dry-run plan.
 */
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function runCli(command: string) {
	const proc = Bun.spawn([process.execPath, CLI, command, "--dry-run"], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

describe("pipeline translate", () => {
	for (const command of ["translate", "translation"]) {
		it(`\`${command}\` exposes the Aphrody translation owner plan`, async () => {
			const { stdout, stderr, code } = await runCli(command);
			expect(code).toBe(0);
			expect(stderr).toBe("");
			expect(stdout).toContain("traduction-boucle.ts");
			expect(stdout).toContain("Aphrody Rust translation");
		});
	}

	it("exports the unified translation runner", async () => {
		expect(existsSync(fileURLToPath(new URL("../src/workflows.ts", import.meta.url)))).toBe(true);
		const mod = (await import("../src/index")) as Record<string, unknown>;
		expect("runTranslation" in mod).toBe(true);
	});
});
