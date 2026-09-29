// SPDX-License-Identifier: Apache-2.0
/** `@shenron/pipeline/aphrody/cli` against a fixture executable (no real aphrody binary). */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aphrodyDoctor, aphrodyGitInspect, runAphrodyCli } from "../../src/aphrody/cli";

let dir = "";
let bin = "";

const FIXTURE = `
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "doctor") console.log(JSON.stringify({ verdict: "OK", args: rest }));
else if (cmd === "git") console.log(JSON.stringify({ head: "abc123", repo: rest[1] }));
else if (cmd === "fail") { console.error("boom"); process.exit(3); }
else if (cmd === "sleep") await Bun.sleep(20_000);
else if (cmd === "text") console.log("not json at all");
`;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "aphrody-cli-"));
	const script = join(dir, "fixture.ts");
	writeFileSync(script, FIXTURE);
	if (process.platform === "win32") {
		bin = join(dir, "aphrody.cmd");
		writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
	} else {
		bin = join(dir, "aphrody");
		writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
		chmodSync(bin, 0o755);
	}
});

afterAll(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("runAphrodyCli", () => {
	it("parses JSON on success", async () => {
		const res = await aphrodyDoctor({ bin });
		expect(res.kind).toBe("exit");
		if (res.kind !== "exit" || !res.ok) throw new Error("expected success");
		expect(res.data?.verdict).toBe("OK");
		expect(res.data?.args).toEqual(["--json"]);
	});

	it("passes the repository to git inspect", async () => {
		const res = await aphrodyGitInspect("some-repo", { bin });
		if (res.kind !== "exit" || !res.ok) throw new Error("expected success");
		expect(res.data).toEqual({ head: "abc123", repo: "some-repo" });
	});

	it("classifies a non-zero exit", async () => {
		const res = await runAphrodyCli(["fail"], { bin, json: true });
		expect(res.kind).toBe("exit");
		if (res.kind !== "exit") throw new Error("unreachable");
		expect(res.ok).toBe(false);
		expect(res.code).toBe(3);
		expect(res.stderr).toContain("boom");
	});

	it("classifies a timeout", async () => {
		const res = await runAphrodyCli(["sleep"], { bin, timeoutMs: 300 });
		expect(res.kind).toBe("timeout");
	}, 15_000);

	it("classifies invalid JSON", async () => {
		const res = await runAphrodyCli(["text"], { bin, json: true });
		expect(res.kind).toBe("invalid_json");
		if (res.kind !== "invalid_json") throw new Error("unreachable");
		expect(res.stdout).toContain("not json");
	});

	it("reports a missing binary as not_found", async () => {
		const res = await runAphrodyCli(["doctor"], { bin: "aphrody-definitely-missing-binary" });
		expect(res.kind).toBe("not_found");
	});
});
