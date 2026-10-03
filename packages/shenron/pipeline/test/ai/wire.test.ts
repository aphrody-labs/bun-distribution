// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as wire from "../../src/ai/wire";

const FIXTURES = join(import.meta.dir, "fixtures");
type Schema = { safeParse(v: unknown): { success: boolean } };
const schemas = wire as unknown as Record<string, Schema>;

const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json") && !f.startsWith("rag-"))
  .toSorted();

describe("wire fixtures", () => {
  test("non-RAG route families retain wire fixtures; RAG is qualified live", () => {
    const routes = new Set(
      files.map((f) => JSON.parse(readFileSync(join(FIXTURES, f), "utf8")).route),
    );
    for (const name of Object.keys(wire.SHENRON_ROUTES)) {
      if (!name.startsWith("rag")) expect(routes.has(name)).toBe(true);
    }
  });

  for (const file of files) {
    test(`${file} parses and cites its source line`, () => {
      const fx = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
      expect(fx.$source).toMatch(/^aphrody-ai\/crates\/aphrody-mcp\/src\/http_rest\.rs:\d+$/);
      expect(schemas[fx.schema]?.safeParse(fx.response).success).toBe(true);
      if (fx.request !== undefined)
        expect(schemas[fx.requestSchema]?.safeParse(fx.request).success).toBe(true);
    });
  }

  test("schemas reject malformed bodies", () => {
    expect(wire.HealthResponse.safeParse({ status: "down", capabilities: {} }).success).toBe(false);
    expect(wire.VisionResponse.safeParse({ result: [], model: "m" }).success).toBe(false);
  });
});

describe("APHRODY_LIMITS", () => {
  test("match http_rest.rs", () => {
    expect(wire.APHRODY_LIMITS.chatMessages).toBe(32);
    expect(wire.APHRODY_LIMITS.chatMessageBytes).toBe(32 * 1024);
    expect(wire.APHRODY_LIMITS.embedTexts).toBe(16);
    expect(wire.APHRODY_LIMITS.embedTextBytes).toBe(8192);
    expect(wire.APHRODY_LIMITS.imageBase64Bytes).toBe(24 * 1024 * 1024);
    expect(Object.isFrozen(wire.APHRODY_LIMITS)).toBe(true);
  });
});
