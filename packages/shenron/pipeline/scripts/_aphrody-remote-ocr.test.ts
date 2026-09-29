import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { legacyAuditProjection, recogniseRemotePage, reviewRemoteImage, runRemoteBatch, toOcrResultV2 } from "@shenron/pipeline/aphrody/remote-ocr";

const oldToken = process.env.APHRODY_SHENRON_API_TOKEN;
const oldUrl = process.env.APHRODY_SHENRON_API_URL;
const oldAiUrl = process.env.APHRODY_AI_HTTP_URL;
beforeEach(() => {
	process.env.APHRODY_AI_HTTP_URL = "http://127.0.0.1:8789";
	process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
});
afterEach(() => {
	if (oldToken === undefined) delete process.env.APHRODY_SHENRON_API_TOKEN;
	else process.env.APHRODY_SHENRON_API_TOKEN = oldToken;
	if (oldUrl === undefined) delete process.env.APHRODY_SHENRON_API_URL;
	else process.env.APHRODY_SHENRON_API_URL = oldUrl;
	if (oldAiUrl === undefined) delete process.env.APHRODY_AI_HTTP_URL;
	else process.env.APHRODY_AI_HTTP_URL = oldAiUrl;
});

const valid = {
	text: "悟空",
	textless: false,
	suspect: false,
	model: "ppocr-v5-mobile",
	elapsed_ms: 123,
	quality: { mean_confidence: 0.91 },
	blocks: [{ text: "悟空", confidence: 0.91, polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], role: "text" }],
};

test("remote PP-OCR sends image bytes and preserves geometric evidence", async () => {
	process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		expect(String(input)).toBe("http://127.0.0.1:8789/api/v1/shenron/ocr");
		expect(init?.headers).toMatchObject({ authorization: "Bearer test-token" });
		expect(JSON.parse(String(init?.body))).toMatchObject({ image_base64: "AQID", engine: "ppocr", model: "ppocr-v5-mobile", include_geometry: true });
		return Response.json(valid);
	}) as typeof fetch;
	const result = await recogniseRemotePage(new Uint8Array([1, 2, 3]), undefined, fetcher);
	expect(result.blocks[0]?.polygon).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
	const record = toOcrResultV2("/lot/0001.jpg", new Uint8Array([1, 2, 3]), result);
	expect(record.schema).toBe("aphrody.ocr.result/v2");
	expect(record.status).toBe("text");
	expect(record.blocks).toHaveLength(1);
	expect(record.attempts[0]?.run.backend).toBe("aphrody-ppocr-http");
});

test("remote PP-OCR rejects missing geometry and does not write an invalid page", async () => {
	process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
	const dir = await mkdtemp(join(tmpdir(), "shenron-ocr-"));
	try {
		await Bun.write(join(dir, "0001.jpg"), new Uint8Array([1, 2, 3]));
		const output = join(dir, "result.jsonl");
		const fetcher = (async () => Response.json({ ...valid, blocks: [{ text: "悟空", confidence: 0.91 }] })) as typeof fetch;
		await expect(runRemoteBatch(dir, output, undefined, undefined, fetcher)).rejects.toThrow("geometry");
		expect(await Bun.file(output).exists()).toBe(false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("remote batch resumes without retranscribing completed images", async () => {
	process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
	const dir = await mkdtemp(join(tmpdir(), "shenron-ocr-"));
	try {
		await Bun.write(join(dir, "0001.jpg"), new Uint8Array([1, 2, 3]));
		await Bun.write(join(dir, "0002.jpg"), new Uint8Array([4, 5, 6]));
		const output = join(dir, "result.jsonl");
		let requests = 0;
		const fetcher = (async () => { requests++; return Response.json(valid); }) as typeof fetch;
		expect(await runRemoteBatch(dir, output, undefined, undefined, fetcher)).toBe(2);
		expect(await runRemoteBatch(dir, output, undefined, undefined, fetcher)).toBe(0);
		expect(requests).toBe(2);
		expect((await Bun.file(output).text()).trim().split("\n")).toHaveLength(2);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("visual review sends the actual image and rejects model substitution", async () => {
	process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		expect(String(input)).toBe("http://127.0.0.1:8789/api/v1/shenron/vision/structured");
		expect(JSON.parse(String(init?.body))).toMatchObject({
			image_base64: "AQID", image_mime: "image/jpeg", prompt: "Read the page", model: "gpt-5.6-luna", reasoning_effort: "low",
		});
		return Response.json({ model: "different-model", result: { schemaVersion: 1 } });
	}) as typeof fetch;
	await expect(reviewRemoteImage(new Uint8Array([1, 2, 3]), "image/jpeg", "Read the page", "gpt-5.6-luna", fetcher))
		.rejects.toThrow("model");
});

test("audit projection examines v2 text and refuses uncertain pages", () => {
	const record = toOcrResultV2("/lot/0001.jpg", new Uint8Array([1, 2, 3]), valid);
	const projection = legacyAuditProjection(`${JSON.stringify(record)}\n`);
	expect(projection.expectedText).toBe(1);
	expect(JSON.parse(projection.jsonl.trim())).toEqual({
		image: "/lot/0001.jpg", text: { kind: "text", markdown: "悟空" },
	});
	expect(() => legacyAuditProjection(`${JSON.stringify({ ...record, status: "needs-review" })}\n`)).toThrow("uncertain");
});
