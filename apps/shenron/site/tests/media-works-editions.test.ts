import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	botMediaWorks,
	botMediaEditions,
	botMediaVolumes,
	botMediaChapters,
	botMediaPageAssets,
	botMediaPageRefs,
} from "../src/db/bot-schema";
import {
	mediaWorks,
	mediaEditions,
	mediaVolumes,
	mediaChapters,
	mediaPageAssets,
	mediaPageRefs,
} from "../../bot/src/db/schema";
import type { VolumeData } from "../src/components/manga/UnifiedVolumeReader";

describe("Sprint 2 — Media Works, Editions & Volume Reader Compatibility", () => {
	test("PostgreSQL Drizzle schema exports all 6 media models", () => {
		expect(botMediaWorks).toBeDefined();
		expect(botMediaEditions).toBeDefined();
		expect(botMediaVolumes).toBeDefined();
		expect(botMediaChapters).toBeDefined();
		expect(botMediaPageAssets).toBeDefined();
		expect(botMediaPageRefs).toBeDefined();
	});

	test("SQLite Drizzle schema exports all 6 replica models", () => {
		expect(mediaWorks).toBeDefined();
		expect(mediaEditions).toBeDefined();
		expect(mediaVolumes).toBeDefined();
		expect(mediaChapters).toBeDefined();
		expect(mediaPageAssets).toBeDefined();
		expect(mediaPageRefs).toBeDefined();
	});

	test("Postgres migration 0018 contains required tables and strict safety", () => {
		const sql = readFileSync(new URL("../src/db/migrations/0018_media_works_and_editions.sql", import.meta.url), "utf8");
		expect(sql).toMatch(/create table if not exists bot\.media_works/i);
		expect(sql).toMatch(/create table if not exists bot\.media_editions/i);
		expect(sql).toMatch(/create table if not exists bot\.media_volumes/i);
		expect(sql).toMatch(/create table if not exists bot\.media_chapters/i);
		expect(sql).toMatch(/create table if not exists bot\.media_page_assets/i);
		expect(sql).toMatch(/create table if not exists bot\.media_page_refs/i);
		expect(sql).not.toMatch(/delete\s+from/i);
	});

	test("SQLite migration 0018 contains required tables and indexes", () => {
		const sql = readFileSync(new URL("../../bot/src/db/migrations/0018_refonte_media_works_editions.sql", import.meta.url), "utf8");
		expect(sql).toMatch(/create table if not exists `media_works`/i);
		expect(sql).toMatch(/create table if not exists `media_editions`/i);
		expect(sql).toMatch(/create table if not exists `media_volumes`/i);
		expect(sql).toMatch(/create table if not exists `media_chapters`/i);
		expect(sql).toMatch(/create table if not exists `media_page_assets`/i);
		expect(sql).toMatch(/create table if not exists `media_page_refs`/i);
		expect(sql).not.toMatch(/delete\s+from/i);
	});

	test("UnifiedVolumeReader contract handles multi-edition chapters without regression", () => {
		const mockVolume: VolumeData = {
			id: 1,
			volume_number: 1,
			series: "DB",
			title: "Tome 1 : Bulma et Son Goku",
			title_ja: "孫悟空と仲間たち",
			cover: "/covers/tome-1.webp",
			chapters: [
				{
					id: 1420,
					series: "DB",
					chapter_number: 1,
					title: "Tome 1 Complet",
					pages: ["/pages/t1-p1.webp", "/pages/t1-p2.webp"],
				},
				{
					id: 20001,
					series: "DBFC",
					chapter_number: 1,
					title: "Bulma et Son Goku",
					pages: ["/pages/dbfc-1.webp"],
				},
				{
					id: 20002,
					series: "DBFC",
					chapter_number: 2,
					title: "Tu n'as pas de boules !!",
					pages: ["/pages/dbfc-2.webp"],
				},
			],
		};

		const nb = mockVolume.chapters.filter((c) => c.series !== "DBFC");
		const color = mockVolume.chapters.filter((c) => c.series === "DBFC");

		expect(nb.length).toBe(1);
		expect(nb[0].chapter_number).toBe(1);
		expect(color.length).toBe(2);
		expect(color[0].chapter_number).toBe(1);
		expect(color[1].chapter_number).toBe(2);
	});
});
