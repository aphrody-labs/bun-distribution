// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resumeOffset, safeArtifactName } from "../src/drive-model-sync.ts";
describe("protected training artifact upload", () => {
  test("resumes from the server acknowledgement, not the client chunk end", () => {
    expect(resumeOffset(null, 100)).toBe(0);
    expect(resumeOffset("bytes=0-49", 100)).toBe(50);
    expect(resumeOffset("bytes=0-99", 100)).toBe(100);
    expect(() => resumeOffset("bytes=0-100", 100)).toThrow();
    expect(() => resumeOffset("bytes=10-49", 100)).toThrow();
  });
  test("keeps credentials and path traversal outside artifact scope", () => {
    expect(safeArtifactName("models/embed/model/model.safetensors")).toBe(true);
    expect(safeArtifactName("training/triples.jsonl")).toBe(true);
    expect(safeArtifactName("models/embed/tokenizer.json")).toBe(true);
    for (const name of [
      "../gold.jsonl",
      "models/credentials.json",
      "models/token.json",
      "models/.env",
      "/model.onnx",
      "models/run.exe",
    ])
      expect(safeArtifactName(name)).toBe(false);
  });
});
