import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/lib/db", () => ({ db: { execute: async () => [] } }));

const { externalSourceHref, externalSourceId, externalSourceUrlFromId } =
	await import("../src/lib/external-source-catalog");

describe("external source public identifiers", () => {
	test("round-trips an HTTPS source URL into its dedicated public route", () => {
		const url = "https://lineup.toei-anim.co.jp/ja/tv/dragon_kai/episode/42/";
		const id = externalSourceId(url);
		expect(externalSourceUrlFromId(id)).toBe(url);
		expect(externalSourceHref(url)).toBe(`/sources/dragon-ball/${id}`);
	});

	test("rejects malformed identifiers and non-canonical encodings", () => {
		expect(externalSourceUrlFromId("../../etc-passwd")).toBeNull();
		expect(externalSourceUrlFromId("aHR0cHM6Ly9leGFtcGxlLmNvbQ")).toBeNull();
	});
});
