import { describe, expect, test } from "bun:test";
import {
  resolveLlmConfig,
  hasCredentials,
  resolveClient,
  createGeminiClient,
  DEFAULT_MODEL,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../src/llm.js";

describe("resolveLlmConfig", () => {
  test("uses Aphrody Vertex defaults", () => {
    const cfg = resolveLlmConfig({});
    expect(cfg.project).toBe("aphrody");
    expect(cfg.location).toBe("us-central1");
    expect(cfg.model).toBe(DEFAULT_MODEL);
    expect(cfg.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  test("honours the RGFR Vertex project", () => {
    expect(resolveLlmConfig({ APHRODY_VERTEX_PROJECT: "rgfr" }).project).toBe("rgfr");
  });

  test("honours model, Vertex location and timeout overrides", () => {
    const cfg = resolveLlmConfig({
      GOOGLE_CLOUD_PROJECT: "rgfr",
      GOOGLE_CLOUD_LOCATION: "europe-west1",
      DOC_AI_MODEL: "gemini-1.5-pro",
      DOC_AI_REQUEST_TIMEOUT_MS: "1234",
    });
    expect(cfg.model).toBe("gemini-1.5-pro");
    expect(cfg.project).toBe("rgfr");
    expect(cfg.location).toBe("europe-west1");
    expect(cfg.requestTimeoutMs).toBe(1234);
  });

  test("invalid timeout falls back to the default", () => {
    expect(resolveLlmConfig({ DOC_AI_REQUEST_TIMEOUT_MS: "nope" }).requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(resolveLlmConfig({ DOC_AI_REQUEST_TIMEOUT_MS: "-5" }).requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });
});

describe("hasCredentials / resolveClient", () => {
  test("hasCredentials reflects ADC/project presence", () => {
    expect(hasCredentials({})).toBe(false);
    expect(hasCredentials({ GOOGLE_CLOUD_PROJECT: "aphrody" })).toBe(true);
    expect(hasCredentials({ GOOGLE_APPLICATION_CREDENTIALS: "adc.json" })).toBe(true);
  });

  test("resolveClient returns null without credentials (offline)", () => {
    expect(resolveClient({})).toBeNull();
  });

  test("resolveClient builds a client when credentials exist", () => {
    const client = resolveClient({ GOOGLE_CLOUD_PROJECT: "aphrody" });
    expect(client).not.toBeNull();
    expect(typeof client?.complete).toBe("function");
  });

  test("createGeminiClient builds from the shared Vertex config", () => {
    const client = createGeminiClient({
      project: "aphrody",
      location: "us-central1",
      model: DEFAULT_MODEL,
      requestTimeoutMs: 1000,
    });
    expect(typeof client.complete).toBe("function");
  });
});
