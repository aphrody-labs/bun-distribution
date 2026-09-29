import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const script = join(import.meta.dir, "ocr-databooks-tesseract.ts");
const result = {
	text: "悟空", textless: false, suspect: false, model: "ppocr-v5-mobile", elapsed_ms: 8,
	quality: { mean_confidence: 0.96 },
	blocks: [{ text: "悟空", confidence: 0.96, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
};

async function invoke(root: string, preload: string, book?: string): Promise<number> {
	const args = [process.execPath, "--preload", preload, script, root, "2"];
	if (book) args.push(book);
	const proc = Bun.spawn(args, {
		env: { ...process.env, APHRODY_SHENRON_API_URL: "http://127.0.0.1:8789", APHRODY_SHENRON_API_TOKEN: "test-only" },
		stdout: "pipe", stderr: "pipe",
	});
	await new Response(proc.stdout).text();
	await new Response(proc.stderr).text();
	return proc.exited;
}

async function mockFetch(root: string, response: unknown): Promise<string> {
	const path = join(root, "mock-fetch.ts");
	await Bun.write(path, `import { appendFile } from "node:fs/promises"; globalThis.fetch = async () => { await appendFile(${JSON.stringify(join(root, "calls.txt"))}, "call\\n"); return Response.json(${JSON.stringify(response)}); };`);
	return path;
}

test("legacy databook entry point offloads OCR, keeps v2 evidence, and resumes", async () => {
	const root = await mkdtemp(join(tmpdir(), "shenron-databook-ocr-"));
	const imageDir = join(root, "lot-001", "images");
	await mkdir(imageDir, { recursive: true });
	await Bun.write(join(imageDir, "386-1.jpg"), new Uint8Array([1, 2, 3]));
	await Bun.write(join(imageDir, "387-1.jpg"), new Uint8Array([4, 5, 6]));
	const preload = await mockFetch(root, result);
	try {
		expect(await invoke(root, preload, "386")).toBe(0);
		expect((await Bun.file(join(root, "calls.txt")).text()).trim().split("\n")).toHaveLength(1);
		const legacyPath = join(root, "lot-001", "resultats.jsonl");
		const v2Path = join(root, "lot-001", "aphrody-resultats-v2.jsonl");
		const legacy = JSON.parse((await Bun.file(legacyPath).text()).trim()) as { image: string; text: { markdown: string } };
		expect(legacy).toEqual({ image: "386-1.jpg", text: { kind: "text", markdown: "悟空" } });
		expect(JSON.parse((await Bun.file(v2Path).text()).trim()).schema).toBe("aphrody.ocr.result/v2");
		expect(await invoke(root, preload, "386")).toBe(0);
		expect((await Bun.file(join(root, "calls.txt")).text()).trim().split("\n")).toHaveLength(1);
		expect((await Bun.file(legacyPath).text()).trim().split("\n")).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("uncertain Aphrody OCR cannot become editorial candidate", async () => {
	const root = await mkdtemp(join(tmpdir(), "shenron-databook-ocr-"));
	const imageDir = join(root, "lot-001", "images");
	await mkdir(imageDir, { recursive: true });
	await Bun.write(join(imageDir, "386-1.jpg"), new Uint8Array([1, 2, 3]));
	const preload = await mockFetch(root, { ...result, suspect: true });
	try {
		expect(await invoke(root, preload)).not.toBe(0);
		expect(await Bun.file(join(root, "lot-001", "resultats.jsonl")).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
