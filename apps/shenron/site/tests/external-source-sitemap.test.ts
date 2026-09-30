import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let rows: Array<{ url: string; fetchedAt: string }> = [];
mock.module("@/lib/db", () => ({ db: { execute: async () => rows } }));

const { listExternalSourceSitemapRecords } = await import("../src/lib/external-source-catalog");

afterEach(() => {
	rows = [];
});

describe("external source sitemap records", () => {
	test("keeps each successful source URL and its crawl timestamp", async () => {
		rows = [
			{
				url: "https://www.toei-animation.com/catalog/dragon-ball/",
				fetchedAt: "2026-09-15T11:28:10.000Z",
			},
		];
		await expect(listExternalSourceSitemapRecords()).resolves.toEqual([
			{ url: rows[0]!.url, fetchedAt: new Date(rows[0]!.fetchedAt) },
		]);
	});
});
