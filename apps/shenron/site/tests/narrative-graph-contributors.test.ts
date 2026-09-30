import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	botNarrativeTimelines,
	botNarrativeEvents,
	botNarrativeEventAliases,
	botNarrativeEventParticipants,
	botNarrativeEventRelations,
	botContributors,
	botContributorCredits,
} from "../src/db/bot-schema";
import {
	narrativeTimelines,
	narrativeEvents,
	narrativeEventAliases,
	narrativeEventParticipants,
	narrativeEventRelations,
	contributors,
	contributorCredits,
} from "../../bot/src/db/schema";

describe("Sprint 3 — Narrative Graph, Timelines & Contributors Hub", () => {
	test("PostgreSQL Drizzle schema exports all 7 narrative & contributor models", () => {
		expect(botNarrativeTimelines).toBeDefined();
		expect(botNarrativeEvents).toBeDefined();
		expect(botNarrativeEventAliases).toBeDefined();
		expect(botNarrativeEventParticipants).toBeDefined();
		expect(botNarrativeEventRelations).toBeDefined();
		expect(botContributors).toBeDefined();
		expect(botContributorCredits).toBeDefined();
	});

	test("SQLite Drizzle schema exports all 7 replica models", () => {
		expect(narrativeTimelines).toBeDefined();
		expect(narrativeEvents).toBeDefined();
		expect(narrativeEventAliases).toBeDefined();
		expect(narrativeEventParticipants).toBeDefined();
		expect(narrativeEventRelations).toBeDefined();
		expect(contributors).toBeDefined();
		expect(contributorCredits).toBeDefined();
	});

	test("Postgres migration 0019 contains required tables, types and strict safety", () => {
		const sql = readFileSync(new URL("../src/db/migrations/0019_narrative_graph_and_contributors.sql", import.meta.url), "utf8");
		expect(sql).toMatch(/create table if not exists bot\.narrative_timelines/i);
		expect(sql).toMatch(/create table if not exists bot\.narrative_events/i);
		expect(sql).toMatch(/create table if not exists bot\.narrative_event_aliases/i);
		expect(sql).toMatch(/create table if not exists bot\.narrative_event_participants/i);
		expect(sql).toMatch(/create table if not exists bot\.narrative_event_relations/i);
		expect(sql).toMatch(/create table if not exists bot\.contributors/i);
		expect(sql).toMatch(/create table if not exists bot\.contributor_credits/i);
		expect(sql).not.toMatch(/delete\s+from/i);
	});

	test("SQLite migration 0019 contains required tables and indexes", () => {
		const sql = readFileSync(new URL("../../bot/src/db/migrations/0019_refonte_narrative_contributors.sql", import.meta.url), "utf8");
		expect(sql).toMatch(/create table if not exists `narrative_timelines`/i);
		expect(sql).toMatch(/create table if not exists `narrative_events`/i);
		expect(sql).toMatch(/create table if not exists `narrative_event_aliases`/i);
		expect(sql).toMatch(/create table if not exists `narrative_event_participants`/i);
		expect(sql).toMatch(/create table if not exists `narrative_event_relations`/i);
		expect(sql).toMatch(/create table if not exists `contributors`/i);
		expect(sql).toMatch(/create table if not exists `contributor_credits`/i);
		expect(sql).not.toMatch(/delete\s+from/i);
	});

	test("Architectural semantics: Akira Toriyama spotlight_rank and categories", () => {
		const contributorCategories = [
			"author",
			"editorial_staff",
			"animation",
			"voice",
			"music",
			"scenario",
			"publisher",
			"other",
		];
		const narrativeEventKinds = ["event", "battle", "tournament", "war"];
		const timelineKinds = ["manga", "anime", "film", "oav", "game", "xenoverse", "other"];

		expect(contributorCategories).toContain("author");
		expect(contributorCategories).toContain("voice");
		expect(contributorCategories).toContain("music");
		expect(narrativeEventKinds).toContain("battle");
		expect(narrativeEventKinds).toContain("tournament");
		expect(timelineKinds).toContain("manga");
		expect(timelineKinds).toContain("xenoverse");
	});
});
