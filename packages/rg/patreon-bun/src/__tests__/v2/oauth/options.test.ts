import { describe, expect, test } from "bun:test";

import { DefaultRestOptions } from "../../../v2";

describe("rest options", () => {
	test("default options", async () => {
		expect(await DefaultRestOptions.getAccessToken()).toEqual(undefined);
		expect(DefaultRestOptions.fetch).toBeTypeOf("function");
	});
});
