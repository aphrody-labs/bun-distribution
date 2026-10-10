// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { isCompiledBinary, getBotRuntimeInfo } from "../src/runtime";

describe("runtime detection", () => {
	test("isCompiledBinary returns false when executed by bun test runner", () => {
		expect(isCompiledBinary()).toBe(false);
	});

	test("getBotRuntimeInfo returns complete runtime descriptors", () => {
		const info = getBotRuntimeInfo();
		expect(info.isCompiled).toBe(false);
		expect(info.bunVersion).toBeDefined();
		expect(info.platform).toBe(process.platform);
		expect(info.arch).toBe(process.arch);
		expect(info.execPath).toBe(process.execPath);
	});
});
