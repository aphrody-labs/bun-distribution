import { describe, test } from "bun:test";

import { AdditionalKeys } from "../../utils/fields";

describe("additional keys", () => {
	test("include all keys", () => {
		const _1: AdditionalKeys<"test", { test: string[] }> = {
			test: [],
		};

		const _2: AdditionalKeys<"test" | "another_test", { test: string[]; another_test: string[] }> = {
			test: [],
			another_test: [],
		};

		const _3: AdditionalKeys<"test", { test: string[]; another_test: string[] }> = {
			test: [],
			another_test: [],
		};

		const _4: AdditionalKeys<string, { test: string[]; another_test: string[] }> = {
			test: [],
			another_test: [],
		};
	});

	test("omit keys", () => {
		const _: AdditionalKeys<never, { test: string[]; another_test: string[] }> = 0;
	});
});
