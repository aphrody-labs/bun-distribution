// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { SHENRON_E5 } from "../../src/ai/config";
import { SHENRON_E5 as fromRoot, PROMPT_VERSION } from "../../src/ai/index";

describe("SHENRON_E5", () => {
	test("matches the embedder served by aphrody-shenron-embed", () => {
		expect(SHENRON_E5).toEqual({
			modelId: "Xenova/multilingual-e5-small",
			dimensions: 384,
			maxInputs: 16,
			maxChars: 8192,
		});
	});

	test("is frozen and re-exported from the package root", () => {
		expect(Object.isFrozen(SHENRON_E5)).toBe(true);
		expect(fromRoot).toBe(SHENRON_E5);
		expect(PROMPT_VERSION).toBe("1");
	});
});
