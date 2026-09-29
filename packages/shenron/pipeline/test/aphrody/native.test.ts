// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { aphrodyNative, isNativeAvailable, nativeAbiVersion, nativeVersion } from "../../src/aphrody/native";

describe("@shenron/pipeline/aphrody/native FFI bridge", () => {
	it("detects whether native library is available on host", () => {
		const available = isNativeAvailable();
		expect(typeof available).toBe("boolean");
	});

	it("returns valid ABI version and version string when loaded", () => {
		if (!isNativeAvailable()) return;
		expect(nativeAbiVersion()).toBe(1);
		const ver = nativeVersion();
		expect(ver).not.toBeNull();
		expect(ver?.length).toBeGreaterThan(0);
	});

	it("executes captured doctor command in-process", async () => {
		if (!isNativeAvailable()) return;
		const doc = await aphrodyNative.doctor();
		expect(doc).not.toBeNull();
		expect(doc?.pillar).toBe("shenron_sovereign_bridge");
		expect(doc?.status).toBe("operational");
	});

	it("executes in-process RAG search with non-empty results", async () => {
		if (!isNativeAvailable()) return;
		const hits = await aphrodyNative.ragSearch("Kamehameha", { limit: 2 });
		expect(Array.isArray(hits)).toBe(true);
		expect(hits.length).toBeGreaterThanOrEqual(1);
		expect(hits[0].title).toBeDefined();
		expect(hits[0].score).toBeGreaterThan(0);
	});

	it("exposes only sanitized authentication presence flags", () => {
		if (!isNativeAvailable()) return;
		const status = aphrodyNative.authStatus();
		expect(status).not.toBeNull();
		expect(Object.keys(status ?? {}).sort()).toEqual(["adminCredentialsPresent", "configured"]);
		expect(typeof status?.configured).toBe("boolean");
		expect(typeof status?.adminCredentialsPresent).toBe("boolean");
	});

	it("loads sovereign persona prompt in-process", async () => {
		if (!isNativeAvailable()) return;
		const prompt = await aphrodyNative.personaPrompt();
		expect(prompt).not.toBeNull();
		expect(prompt).toContain("Akira Toriyama");
		expect(prompt).toContain("Tori-bot");
	});
});
