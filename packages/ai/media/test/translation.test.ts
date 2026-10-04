// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { TranslationHttpClient, normalizeLang } from "../src/translation-http";

test("normalizes supported language aliases consistently", () => {
  expect(["JP", "en-US", "pt-br", undefined].map(normalizeLang)).toEqual([
    "ja",
    "en",
    "pt",
    "auto",
  ]);
});
test("Lingva advances through configured instances and reports the actual provider", async () => {
  const calls: string[] = [];
  const client = new TranslationHttpClient({
    lingvaInstances: async () => ["http://failed.test", "http://working.test"],
    libretranslate: () => ({ baseUrl: "http://libre.test" }),
    fetch: (async (input: string | URL) => {
      calls.push(String(input));
      return String(input).includes("failed")
        ? new Response(null, { status: 503 })
        : Response.json({ translation: "Bonjour", info: { detectedSource: "EN" } });
    }) as unknown as typeof fetch,
  });
  expect(await client.lingva("Hello", "FR", "en-US")).toEqual({
    source: "Hello",
    translated: "Bonjour",
    detectedLang: "en",
    provider: "lingva",
  });
  expect(calls).toEqual([
    "http://failed.test/api/v1/en/fr/Hello",
    "http://working.test/api/v1/en/fr/Hello",
  ]);
});
test("Google failures stay failures and exhausted providers are marked unavailable", async () => {
  const client = new TranslationHttpClient({
    lingvaInstances: async () => ["http://failed.test"],
    libretranslate: () => ({ baseUrl: "http://libre.test" }),
    fetch: (async () => new Response(null, { status: 429 })) as unknown as typeof fetch,
  });
  await expect(client.googleGtx("Hello")).rejects.toThrow("429");
  expect(client.googleAvailable).toBe(false);
  await expect(client.lingva("Hello")).rejects.toThrow("429");
  expect(client.lingvaAvailable).toBe(false);
});
test("LibreTranslate preserves configured credentials in its request and rejects empty output", async () => {
  const client = new TranslationHttpClient({
    lingvaInstances: async () => [],
    libretranslate: () => ({ baseUrl: "http://libre.test", apiKey: "fixture-key" }),
    fetch: (async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        q: "Hello",
        source: "en",
        target: "fr",
        format: "text",
        api_key: "fixture-key",
      });
      return Response.json({ translatedText: "" });
    }) as unknown as typeof fetch,
  });
  await expect(client.libretranslate("Hello", "fr", "en")).rejects.toThrow("vide");
});
