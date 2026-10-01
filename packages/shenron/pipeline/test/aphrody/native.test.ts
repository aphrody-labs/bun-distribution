// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  aphrodyNative,
  isNativeAvailable,
  nativeAbiVersion,
  nativeVersion,
} from "../../src/aphrody/native";

const nativeAvailable = isNativeAvailable();
const requireNative = process.env.APHRODY_FFI_REQUIRE_NATIVE === "1";

describe("@shenron/pipeline/aphrody/native FFI bridge", () => {
  it("detects whether native library is available on host", () => {
    expect(typeof nativeAvailable).toBe("boolean");
    if (requireNative) expect(nativeAvailable).toBe(true);
  });

  it.skipIf(!nativeAvailable)("returns valid ABI version and version string when loaded", () => {
    expect(nativeAbiVersion()).toBe(1);
    const ver = nativeVersion();
    expect(ver).not.toBeNull();
    expect(ver?.length).toBeGreaterThan(0);
  });

  it.skipIf(!nativeAvailable)("executes captured doctor command in-process", async () => {
    const doc = await aphrodyNative.doctor();
    expect(doc).not.toBeNull();
    expect(doc?.pillar).toBe("shenron_sovereign_bridge");
    expect(["operational", "degraded"]).toContain(doc?.status as string);
  });

  it.skipIf(!nativeAvailable)(
    "returns in-process RAG results with typed hits when present",
    async () => {
      const hits = await aphrodyNative.ragSearch("Kamehameha", { limit: 2 });
      expect(Array.isArray(hits)).toBe(true);
      if (hits.length > 0) {
        expect(hits[0].title).toBeDefined();
        expect(hits[0].score).toBeGreaterThan(0);
      }
    },
  );

  it.skipIf(!nativeAvailable)("exposes only sanitized authentication presence flags", () => {
    const status = aphrodyNative.authStatus();
    expect(status).not.toBeNull();
    expect(Object.keys(status ?? {}).toSorted()).toEqual(["adminCredentialsPresent", "configured"]);
    expect(typeof status?.configured).toBe("boolean");
    expect(typeof status?.adminCredentialsPresent).toBe("boolean");
  });

  it.skipIf(!nativeAvailable)("loads sovereign persona prompt in-process", async () => {
    const prompt = await aphrodyNative.personaPrompt();
    expect(prompt).not.toBeNull();
    const expectedPersonaPath = process.env.APHRODY_FFI_TEST_PERSONA_PATH;
    if (requireNative) expect(expectedPersonaPath).toBeDefined();
    if (expectedPersonaPath) {
      expect(prompt).toBe(await Bun.file(expectedPersonaPath).text());
    } else {
      expect(prompt?.trim().length).toBeGreaterThan(0);
    }
  });
});
