// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { WIKI_CATEGORIES } from "@shenron/db/constants";
import { z } from "zod";
import * as contract from "../src/contract";
import bodies from "./fixtures/cockpit-bodies.json";
import responses from "./fixtures/bot-responses.json";

const {
  BotAdminStats,
  BotEconomyStats,
  BotServices,
  BotTableRows,
  BotTables,
  BotWikiStats,
  CompleteGoalBody,
  CompleteGoalResponse,
  CreateGoalBody,
  CreateGoalResponse,
  ENDPOINTS,
  ErrorEnvelope,
  EvalRequestBody,
  EvalResponse,
  FeedbackStatusBody,
  FeedbackStatusResponse,
  GoldCaseBody,
  GoldCaseResponse,
  HealthResponse,
  LEGACY_PUBLIC_PATHS,
  PublicStats,
  TablePage,
  WikiCategoriesResponse,
  WikiCategoryName,
  WikiListQuery,
  WikiListResponse,
  endpoints,
  fillPath,
} = contract;

describe("recorded bot responses parse", () => {
  const cases: [string, z.ZodType, unknown][] = [
    ["health", HealthResponse, responses.health],
    ["publicStats", PublicStats, responses.publicStats],
    ["adminStats", BotAdminStats, responses.adminStats],
    ["adminServices", BotServices, responses.adminServices],
    ["adminTables", BotTables, responses.adminTables],
    ["adminTableRows", BotTableRows, responses.adminTableRows],
    ["adminWikiStats", BotWikiStats, responses.adminWikiStats],
    ["adminEconomyStats", BotEconomyStats, responses.adminEconomyStats],
    ["createGoal", CreateGoalResponse, responses.createGoal],
    ["completeGoal", CompleteGoalResponse, responses.completeGoal],
    ["feedbackStatus", FeedbackStatusResponse, responses.feedbackStatus],
    ["goldCase", GoldCaseResponse, responses.goldCase],
    ["runEval", EvalResponse, responses.runEval],
    ["cockpitError", ErrorEnvelope, responses.cockpitError],
  ];
  for (const [name, schema, fixture] of cases) {
    test(name, () => {
      const parsed = schema.safeParse(fixture);
      expect(parsed.error?.issues ?? []).toEqual([]);
    });
  }

  test("admin stats keep extra keys", () => {
    const parsed = BotAdminStats.parse({ stats: { ...responses.adminStats.stats, extra: 1 } });
    expect(parsed.stats).toHaveProperty("extra", 1);
  });
});

describe("ia-cockpit bodies (bot limits)", () => {
  test("recorded site bodies parse", () => {
    expect(CreateGoalBody.parse(bodies.createGoal).priority).toBe("p1");
    expect(CreateGoalBody.parse(bodies.createGoalMinimal).title).toBe("Titre seul");
    expect(CompleteGoalBody.parse(bodies.completeGoal)).toEqual({ notes: "fait" });
    expect(CompleteGoalBody.parse(bodies.completeGoalEmpty)).toEqual({});
    expect(FeedbackStatusBody.parse(bodies.feedbackStatus).status).toBe("reviewed");
    expect(GoldCaseBody.parse(bodies.goldCase).expect).toHaveLength(1);
    expect(EvalRequestBody.parse(bodies.evalRequest).samples).toBe(25);
    expect(EvalRequestBody.parse(bodies.evalRequestFull)).toEqual({});
  });

  test("title <= 200, description <= 4000, enums from @shenron/db/constants", () => {
    const base = { title: "x", userId: "1" };
    expect(CreateGoalBody.safeParse({ ...base, title: "a".repeat(200) }).success).toBe(true);
    expect(CreateGoalBody.safeParse({ ...base, title: "a".repeat(201) }).success).toBe(false);
    expect(CreateGoalBody.safeParse({ ...base, title: "   " }).success).toBe(false);
    expect(CreateGoalBody.safeParse({ ...base, description: "d".repeat(4000) }).success).toBe(true);
    expect(CreateGoalBody.safeParse({ ...base, description: "d".repeat(4001) }).success).toBe(
      false,
    );
    expect(CreateGoalBody.safeParse({ ...base, priority: "p4" }).success).toBe(false);
    expect(FeedbackStatusBody.safeParse({ status: "done" }).success).toBe(false);
    expect(GoldCaseBody.safeParse({ q: "q", expect: [] }).success).toBe(false);
    expect(EvalRequestBody.safeParse({ samples: 1001 }).success).toBe(false);
    expect(EvalRequestBody.safeParse({ samples: 1.5 }).success).toBe(false);
  });
});

describe("wiki schemas", () => {
  test("WikiCategoryName options equal @shenron/db WIKI_CATEGORIES names", () => {
    expect(WikiCategoryName.options).toEqual(WIKI_CATEGORIES.map((c) => c.name));
  });

  test("WikiListQuery: limit 1..200 default 50, offset >= 0, q <= 200", () => {
    expect(WikiListQuery.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(WikiListQuery.parse({ limit: "200", offset: "3", q: "goku" })).toEqual({
      limit: 200,
      offset: 3,
      q: "goku",
    });
    expect(WikiListQuery.safeParse({ limit: "201" }).success).toBe(false);
    expect(WikiListQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(WikiListQuery.safeParse({ offset: "-1" }).success).toBe(false);
    expect(WikiListQuery.safeParse({ q: "q".repeat(201) }).success).toBe(false);
  });

  test("categories and list responses", () => {
    expect(
      WikiCategoriesResponse.parse({
        categories: [{ name: "characters", label: "Personnages", total: 312 }],
      }).categories,
    ).toHaveLength(1);
    expect(
      WikiCategoriesResponse.safeParse({ categories: [{ name: "pokemon", label: "x", total: 1 }] })
        .success,
    ).toBe(false);
    expect(
      WikiListResponse.parse({
        category: "planets",
        items: [{ id: 1, name: "Namek" }],
        total: 41,
        limit: 50,
        offset: 0,
      }).items[0],
    ).toEqual({ id: 1, name: "Namek" });
  });

  test("TablePage builds { rows, total, limit, offset }", () => {
    const page = TablePage(z.object({ id: z.number() }));
    expect(page.parse({ rows: [{ id: 1 }], total: 1, limit: 10, offset: 0 }).rows).toEqual([
      { id: 1 },
    ]);
    expect(page.safeParse({ rows: [{ id: "1" }], total: 1, limit: 10, offset: 0 }).success).toBe(
      false,
    );
  });
});

describe("meta ids and endpoints", () => {
  test("every exported schema with a meta id has a unique id", () => {
    const ids: string[] = [];
    for (const value of Object.values(contract)) {
      if (value instanceof z.ZodType) {
        const id = value.meta()?.id;
        if (typeof id === "string") ids.push(id);
      }
    }
    expect(ids.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every endpoint response carries a meta id", () => {
    for (const endpoint of ENDPOINTS) {
      expect(typeof endpoint.response.meta()?.id).toBe("string");
    }
  });

  test("endpoint ids unique, paths absolute, no nested basePath", () => {
    const ids = ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.path.startsWith("/")).toBe(true);
      expect(endpoint.path).not.toContain(":");
      expect(endpoint.path).not.toContain("//");
    }
    const keyed = Object.entries(endpoints).map(([key, spec]) => [key, spec.id]);
    for (const [key, id] of keyed) expect(id).toBe(key);
  });

  test("legacy public paths are unique and do not overlap the new wiki routes", () => {
    expect(new Set(LEGACY_PUBLIC_PATHS).size).toBe(LEGACY_PUBLIC_PATHS.length);
    expect(LEGACY_PUBLIC_PATHS).toContain("/api/public/stats");
    expect(LEGACY_PUBLIC_PATHS).not.toContain("/api/public/wiki/categories");
    expect(LEGACY_PUBLIC_PATHS).not.toContain("/api/public/openapi.json");
  });

  test("fillPath encodes parameters and rejects missing ones", () => {
    expect(
      fillPath("/api/public/wiki/{category}/{idOrSlug}", { category: "races", idOrSlug: "a b/c" }),
    ).toBe("/api/public/wiki/races/a%20b%2Fc");
    expect(() => fillPath("/api/admin/goals/{id}/complete", {})).toThrow("missing path parameter");
  });
});
