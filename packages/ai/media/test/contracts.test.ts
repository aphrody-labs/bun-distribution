// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  mapNativeKoharuPageResult,
  parseKoharuPageResult,
  KOHARU_PAGE_RESULT_SCHEMA,
} from "../src/manga";
import { parseOcrEvidence } from "../src/ocr";
import { recogniseRemotePage, toOcrResultV2 } from "../src/remote-ocr";

const digest = "a".repeat(64);
const source = {
  kind: "manga" as const,
  pageId: "project:chapter-1:page-1",
  sourceSha256: digest,
  imageSha256: digest,
  mime: "image/png" as const,
  width: 100,
  height: 120,
};
const page = () => ({
  schema: KOHARU_PAGE_RESULT_SCHEMA,
  source: { ...source },
  regions: [],
  artifacts: { cleanupOverlaySha256: null },
  pipeline: { name: "koharu", version: "1" },
});
const generation = { producer: "koharu-ocr", model: "test-model", confidence: 0.9 };
function nativePage() {
  return {
    page: "12345678-1234-1234-1234-123456789abc",
    width: 100,
    height: 120,
    cleanup_layer_png: null,
    cleanup_provenance: null,
    regions: [
      {
        id: "region-1",
        kind: "dialogue",
        label: null,
        bounds: [1, 2, 30, 40],
        polygon: [
          { x: 1, y: 2 },
          { x: 30, y: 2 },
          { x: 30, y: 40 },
          { x: 1, y: 40 },
        ],
        confidence: 0.95,
        detection_labels: [],
        detection_provenance: generation,
        texts: [
          {
            id: "text-1",
            reading_order: 0,
            source: "こんにちは",
            source_language: "ja",
            translation: "Bonjour",
            target_language: "fr",
            ocr_confidence: 0.9,
            ocr_provenance: generation,
            translation_provenance: { ...generation, producer: "koharu-translator" },
          },
        ],
      },
    ],
  };
}

describe("shared manga / translation evidence", () => {
  test("accepts product identities without imposing Shenron's catalogue", () => {
    expect(parseKoharuPageResult(page()).source).toEqual(source);
  });
  test("projects geometry, order, source and translation without inventing confidence", () => {
    const mapped = mapNativeKoharuPageResult(
      { result: nativePage(), sourceSha256: digest },
      source,
    );
    const region = mapped.regions[0]!;
    expect(region.bounds).toEqual({ x: 1, y: 2, width: 29, height: 38 });
    expect(region.readingOrder).toBe(1);
    expect(region.sourceText).toBeNull();
    expect(region.texts[0]).toMatchObject({
      sourceText: "こんにちは",
      translatedText: "Bonjour",
      sourceLanguage: "ja",
      targetLanguage: "fr",
      ocrConfidence: 0.9,
      readingOrder: 1,
      translationProvenance: { producer: "koharu-translator" },
    });
  });
  test("rejects a different source image or different dimensions", () => {
    expect(() =>
      mapNativeKoharuPageResult({ result: nativePage(), sourceSha256: "b".repeat(64) }, source),
    ).toThrow("hash");
    expect(() =>
      mapNativeKoharuPageResult(
        { result: nativePage(), sourceSha256: digest },
        { ...source, width: 99 },
      ),
    ).toThrow("dimensions");
  });
  test("rejects polygons outside the bound image and non-finite confidence", () => {
    const native = nativePage();
    native.regions[0]!.polygon[0]!.x = 101;
    expect(() =>
      mapNativeKoharuPageResult({ result: native, sourceSha256: digest }, source),
    ).toThrow();
    native.regions[0]!.polygon[0]!.x = 1;
    native.regions[0]!.texts[0]!.ocr_confidence = Number.NaN;
    expect(() =>
      mapNativeKoharuPageResult({ result: native, sourceSha256: digest }, source),
    ).toThrow("finite");
  });
});

const bytes = new Uint8Array([1, 2, 3]);
const imageHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const remote = () => ({
  text: "こんにちは",
  textless: false,
  suspect: false,
  blocks: [
    {
      text: "こんにちは",
      confidence: 0.9,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    },
  ],
  quality: { mean_confidence: 0.9 },
  model: "ppocr-v5-mobile",
  elapsed_ms: 12,
});
function evidence(value: unknown) {
  return parseOcrEvidence(value, "project:page-1", imageHash, "image/png", 100, 120);
}
describe("OCR transcription boundary", () => {
  test("retains OCR attempt provenance and image identity", () => {
    const result = evidence(toOcrResultV2("scan.png", bytes, remote()));
    expect(result.pageId).toBe("scan.png");
    expect(result.blocks[0]!.polygon).toEqual(remote().blocks[0]!.polygon);
    expect(result.attempts[0]!.run.modelId).toBe("ppocr-v5-mobile");
    expect(result.status).toBe("text");
  });
  test("keeps uncertain evidence uncertain", () => {
    expect(evidence(toOcrResultV2("scan.png", bytes, { ...remote(), suspect: true })).status).toBe(
      "needs-review",
    );
  });
  test("rejects a textless page as a transcription candidate", () => {
    const result = toOcrResultV2("scan.png", bytes, {
      ...remote(),
      text: "",
      blocks: [],
      textless: true,
    });
    expect(() => evidence(result)).toThrow("cannot become a transcription");
  });
  test("rejects mismatched hashes, identity and unbounded geometry", () => {
    const result = toOcrResultV2("scan.png", bytes, remote());
    expect(() => evidence({ ...result, image: { ...result.image, sha256: digest } })).toThrow(
      "digest",
    );
    expect(() => evidence({ ...result, page_id: "another-page" })).toThrow("page_id");
    result.blocks[0]!.polygon[0]![0] = 101;
    expect(() => evidence(result)).toThrow("leaves the image");
  });
});

test("shared HTTP client uses explicit auth and rejects redirects without forwarding the token", async () => {
  let targetRequests = 0;
  const target = Bun.serve({
    port: 0,
    fetch: () => {
      targetRequests++;
      return Response.json(remote());
    },
  });
  const origin = Bun.serve({
    port: 0,
    fetch: (request) => {
      expect(request.headers.get("authorization")).toBe("Bearer fixture-token");
      return Response.redirect(target.url);
    },
  });
  try {
    await expect(
      recogniseRemotePage(bytes, { baseUrl: origin.url, token: "fixture-token" }),
    ).rejects.toThrow();
    expect(targetRequests).toBe(0);
  } finally {
    origin.stop(true);
    target.stop(true);
  }
});
