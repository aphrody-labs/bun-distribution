import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("legacy lot processor uses Aphrody, preserves evidence, and resumes", async () => {
	const root = await mkdtemp(join(tmpdir(), "shenron-ocr-lots-"));
	const lot = join(root, "lot-001");
	await mkdir(join(lot, "images"), { recursive: true });
	await Bun.write(join(lot, "manifeste.json"), JSON.stringify({ entrees: [{ image: "page.jpg" }] }));
	await Bun.write(join(lot, "images", "page.jpg"), new Uint8Array([1, 2, 3]));
	const callsPath = join(root, "calls.txt");
	const preload = join(root, "mock-fetch.ts");
	const mockResponse = { text: "悟空とドラゴンボール", textless: false, suspect: false, model: "ppocr-v5-mobile", elapsed_ms: 9,
		quality: { mean_confidence: 0.92 }, blocks: [{ text: "悟空とドラゴンボール", confidence: 0.92, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }] };
	await Bun.write(preload, `import { appendFile } from "node:fs/promises"; globalThis.fetch = async () => { await appendFile(${JSON.stringify(callsPath)}, "call\\n"); return Response.json(${JSON.stringify(mockResponse)}); };`);
	const run = async () => {
		const proc = Bun.spawn([process.execPath, "--preload", preload, join(import.meta.dir, "process-ocr-lots.ts")], {
			env: { ...process.env, SHENRON_OCR_LOTS_DIR: root, APHRODY_SHENRON_API_URL: "http://127.0.0.1:8789", APHRODY_SHENRON_API_TOKEN: "test-only" },
			stdout: "pipe", stderr: "pipe",
		});
		await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;
		if (exitCode !== 0) throw new Error(stderr);
		return exitCode;
	};
	try {
		expect(await run()).toBe(0);
		expect(await run()).toBe(0);
		expect((await Bun.file(callsPath).text()).trim().split("\n")).toHaveLength(1);
		const record = JSON.parse((await Bun.file(join(lot, "resultats.jsonl")).text()).trim());
		expect(record.image).toBe("page.jpg");
		expect(record.aphrody.schema).toBe("aphrody.ocr.result/v2");
		expect(record.aphrody.image.sha256).toMatch(/^[a-f0-9]{64}$/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
