// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { NativeInference } from "../src/inference.ts";

test("native profiles and model references are explicit before any library access", async () => {
  await expect(NativeInference.open({ model: "", profile: "dbfr" })).rejects.toThrow("required");
  await expect(NativeInference.open({ model: "installed", profile: "../aphrody" })).rejects.toThrow(
    "required",
  );
});

const children = () => Bun.file(`/proc/${process.pid}/task/${process.pid}/children`).text();
const realModel = process.env.APHRODY_NATIVE_INFERENCE_TEST === "1" ? test : test.skip;
realModel(
  "installed Gemma generates in process without blocking Bun",
  async () => {
    const before = process.platform === "linux" ? await children() : null;
    let ticks = 0;
    const heartbeat = setInterval(() => {
      ticks++;
    }, 10);
    try {
      await using engine = await NativeInference.open({
        model: "gemma-4-e2b-it-q4km",
        profile: "dbfr",
        context: 8192,
      });
      const result = await engine.chat({
        messages: [{ role: "user", content: "Réponds par une courte salutation." }],
        maxTokens: 64,
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.model).toBe("gemma-4-e2b-it-q4km");
      expect(result.profile).toBe("dbfr");
      expect(result.usage?.output).toBeGreaterThan(0);
      expect(ticks).toBeGreaterThan(0);
      if (before !== null) expect(await children()).toBe(before);
      const aborted = new AbortController();
      aborted.abort();
      await expect(
        engine.chat({ messages: [{ role: "user", content: "Bonjour." }], signal: aborted.signal }),
      ).rejects.toThrow();
    } finally {
      clearInterval(heartbeat);
    }
  },
  300_000,
);
