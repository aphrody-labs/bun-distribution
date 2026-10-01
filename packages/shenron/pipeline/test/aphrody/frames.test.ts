// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AphrodyFramesClient } from "../../src/aphrody/frames";

const directory = mkdtempSync(join(tmpdir(), "aphrody-frames-consumer-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function fixture(name: string, code: string): string {
	const path = join(directory, name);
	writeFileSync(path, `#!${process.execPath}\n${code}\n`);
	chmodSync(path, 0o755);
	return path;
}

describe.skipIf(process.platform === "win32")("Rust Frames consumer contract", () => {
	it("routes search flags through the Aphrody CLI and validates JSON output", async () => {
		const bin = fixture("frames-search", `
const args = process.argv.slice(2);
if (args.slice(0, 5).join(" ") !== "web frames search sample.png --remote") process.exit(2);
if (!args.includes("--json") || args[args.indexOf("--limit") + 1] !== "8" || args[args.indexOf("--anilist-id") + 1] !== "42") process.exit(3);
console.log(JSON.stringify({ origin: "trace.moe", matches: [{ title: "Example", fromMs: 1000, atMs: 1000, toMs: 2000, similarity: 0.95, source: "", anilist: 0, preview: { image: "", video: "" } }] }));
`);
		const result = await new AphrodyFramesClient({ bin }).search(" sample.png ", { mode: "--remote", limit: 8, anilistId: 42 });
		expect(result.origin).toBe("trace.moe");
		expect(result.matches[0]?.title).toBe("Example");
	});

	it("propagates owner errors and rejects malformed owner output", async () => {
		const failure = fixture("frames-failure", 'console.error("index unavailable"); process.exit(7);');
		await expect(new AphrodyFramesClient({ bin: failure }).stats()).rejects.toThrow("aphrody exited 7: index unavailable");
		const malformed = fixture("frames-malformed", 'console.log(JSON.stringify({ hash: "x", vector: [1] }));');
		await expect(new AphrodyFramesClient({ bin: malformed }).vector("image.png")).rejects.toThrow("invalid frame vector");
	});

	it("rejects invalid query values before invoking the owner", async () => {
		const bin = fixture("frames-should-not-run", 'process.exit(9);');
		await expect(new AphrodyFramesClient({ bin }).search("x", { limit: 0 })).rejects.toThrow("limit must be a positive integer");
	});

	it("normalizes Aphrody trace quota to Shenron's used and total contract", async () => {
		const bin = fixture("frames-quota", 'console.log(JSON.stringify({ quota: 100, remaining: 73, concurrency: 2 }));');
		expect(await new AphrodyFramesClient({ bin }).quota()).toEqual({ used: 27, total: 100 });
	});
});
