// SPDX-License-Identifier: Apache-2.0
/**
 * S11 : la façade lit l'environnement à l'import, chaque cas tourne donc dans
 * un processus Bun isolé (aucune connexion, aucun réseau).
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const siteDir = join(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "shenron-freeze-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Probe = {
	file: string | null;
	freeze: { reason: string; path: string | null } | null;
	exitCode: number;
	throws: string | null;
};

function probe(env: Record<string, string | undefined>, cwd = siteDir): Probe {
	const script = `
		const m = await import(${JSON.stringify(join(siteDir, "src", "lib", "databooks-freeze.ts"))});
		let throws = null;
		try { m.assertDatabooksWritable(); } catch (e) { throws = e instanceof m.DatabooksFrozenError ? e.code : String(e); }
		console.log(JSON.stringify({ file: m.DATABOOKS_FREEZE_FILE, freeze: m.databooksFreeze(), exitCode: m.DATABOOKS_FREEZE_EXIT_CODE, throws }));
	`;
	const base: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined && k !== "DATABOOKS_FREEZE_FILE" && k !== "NODE_ENV") base[k] = v;
	}
	for (const [k, v] of Object.entries(env)) if (v !== undefined) base[k] = v;
	const res = Bun.spawnSync([process.execPath, "-e", script], { cwd, env: base, stdout: "pipe", stderr: "pipe" });
	if (res.exitCode !== 0) throw new Error(res.stderr.toString());
	const lines = res.stdout.toString().trim().split(/\r?\n/);
	return JSON.parse(lines[lines.length - 1]!) as Probe;
}

describe("databooks-freeze (S11)", () => {
	it("dev + fichier dérivé absent -> libre", () => {
		const emptyCwd = mkdtempSync(join(tmp, "cwd-"));
		const r = probe({ NODE_ENV: "development" }, emptyCwd);
		expect(r.freeze).toBeNull();
		expect(r.throws).toBeNull();
		expect(r.file).toBe(join(emptyCwd, "..", "..", ".coord", "FREEZE-databooks.json"));
	});

	it("production + variable absente -> gelé", () => {
		const r = probe({ NODE_ENV: "production" });
		expect(r.file).toBeNull();
		expect(r.freeze).toEqual({ reason: "DATABOOKS_FREEZE_FILE non configuré", path: null });
		expect(r.throws).toBe("DATABOOKS_FROZEN");
	});

	it("variable -> fichier absent -> libre", () => {
		const file = join(tmp, "absent.json");
		const r = probe({ NODE_ENV: "production", DATABOOKS_FREEZE_FILE: file });
		expect(r.file).toBe(file);
		expect(r.freeze).toBeNull();
	});

	it('fichier {"frozen": false} -> libre', () => {
		const file = join(tmp, "unfrozen.json");
		writeFileSync(file, JSON.stringify({ frozen: false }));
		const r = probe({ NODE_ENV: "production", DATABOOKS_FREEZE_FILE: file });
		expect(r.freeze).toBeNull();
		expect(r.throws).toBeNull();
	});

	it("autre contenu -> gelé avec la raison", () => {
		const file = join(tmp, "frozen.json");
		writeFileSync(file, JSON.stringify({ reason: "quarantaine" }));
		const r = probe({ DATABOOKS_FREEZE_FILE: file });
		expect(r.freeze).toEqual({ reason: "quarantaine", path: file });
		expect(r.throws).toBe("DATABOOKS_FROZEN");
		const raw = join(tmp, "raw.txt");
		writeFileSync(raw, "stop");
		expect(probe({ DATABOOKS_FREEZE_FILE: raw }).freeze?.reason).toBe("stop");
	});

	it("code de sortie 3 inchangé", () => {
		expect(probe({ NODE_ENV: "development" }).exitCode).toBe(3);
	});
});
