import { expect, test } from "bun:test";
import { createGoogleGeminiClient } from "../src/vertex.ts";

test("creates a client from the shared Aphrody runtime", () => {
  const client = createGoogleGeminiClient({
    project: "aphrody",
    location: "us-central1",
    home: "~/.aphrody",
    auth: "adc-or-secret-manager",
  });
  expect(typeof client.complete).toBe("function");
});
