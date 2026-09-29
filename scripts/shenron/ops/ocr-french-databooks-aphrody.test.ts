import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("French databook OCR uses Aphrody and refuses uncertain text", async () => {
	const root = await mkdtemp(join(tmpdir(), "shenron-french-ocr-"));
	const image = join(root, "page.jpg");
	await Bun.write(image, new Uint8Array([1, 2, 3]));
	let calls = 0;
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
		calls++;
		expect(request.headers.get("authorization")).toBe("Bearer test-only");
		expect((await request.json() as { image_base64: string }).image_base64).toBe("AQID");
		return Response.json({
			text: "  Bonjour   ", textless: false, suspect: calls > 1, model: "ppocr-v5-mobile", elapsed_ms: 8,
			quality: { mean_confidence: 0.94 },
			blocks: [{ text: "Bonjour", confidence: 0.94, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
		});
	} });
	try {
		const moduleUrl = pathToFileURL(join(import.meta.dir, "ocr-french-databooks.ts")).href;
		const code = `const { ocrFrenchPage } = await import(${JSON.stringify(moduleUrl)}); const image = ${JSON.stringify(image)}; console.log(await ocrFrenchPage(image)); try { await ocrFrenchPage(image); process.exit(3); } catch (error) { if (!String(error).includes("requiring review")) throw error; }`;
		const proc = Bun.spawn([process.execPath, "-e", code], {
			env: { ...process.env, APHRODY_SHENRON_API_URL: `http://127.0.0.1:${server.port}`, APHRODY_SHENRON_API_TOKEN: "test-only" },
			stdout: "pipe", stderr: "pipe",
		});
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		expect(await proc.exited).toBe(0);
		expect(stderr).toBe("");
		expect(stdout.trim()).toBe("Bonjour");
		expect(calls).toBe(2);
	} finally {
		server.stop(true);
		await rm(root, { recursive: true, force: true });
	}
});
