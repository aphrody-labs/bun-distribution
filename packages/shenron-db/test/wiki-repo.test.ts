// Source: packages/shenron/db/test/wiki-repo.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { drizzle as bunSqlDrizzle } from "drizzle-orm/bun-sql";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle as postgresJsDrizzle } from "drizzle-orm/postgres-js";
import * as botSchema from "../src/bot-schema";
import { WIKI_CATEGORIES, type WikiCategoryName } from "../src/constants";
import { fullSchema } from "../src/full-schema";
import { createWikiReadRepository, escapeLike, toPublicRow, wikiQueries } from "../src/repos/wiki";
import type { ShenronPgDatabase } from "../src/types";
import { WIKI_REGISTRY } from "../src/wiki-registry";

const NO_SLUG = new Set<WikiCategoryName>([
  "characters",
  "episodes",
  "planets",
  "power_levels",
  "timeline_events",
  "transformations",
  "wishes",
]);

const drivers = {
  "postgres-js": postgresJsDrizzle.mock({ schema: fullSchema }),
  "bun-sql": bunSqlDrizzle.mock({ schema: fullSchema }),
} as unknown as Record<string, ShenronPgDatabase>;

interface Compiled {
  sql: string;
  params: unknown[];
}

function assertVisibleBound(q: Compiled) {
  const matches = [...q.sql.matchAll(/"visible" = \$(\d+)/g)];
  expect(matches.length).toBe(1);
  const index = Number(matches[0]![1]) - 1;
  expect(q.params[index]).toBe(true);
  // `visible` appears only in the WHERE clause, never in the select list.
  const selectList = q.sql.slice(0, q.sql.indexOf(" from "));
  expect(selectList).not.toContain('"visible"');
}

function compileAll(db: ShenronPgDatabase): Record<string, Compiled> {
  const q = wikiQueries(db);
  const out: Record<string, Compiled> = {};
  for (const { name } of WIKI_CATEGORIES) {
    out[`${name}:count`] = q.count(name).toSQL();
    out[`${name}:count-q`] = q.count(name, "goku").toSQL();
    out[`${name}:list`] = q.list({ category: name, limit: 10, offset: 5 }).toSQL();
    out[`${name}:list-q`] = q.list({ category: name, limit: 10, offset: 0, q: "Son 50%_" }).toSQL();
    out[`${name}:get-id`] = q.get(name, "42")!.toSQL();
    const bySlug = q.get(name, "son-goku");
    if (bySlug) out[`${name}:get-slug`] = bySlug.toSQL();
  }
  return out;
}

describe("wiki registry", () => {
  test("21 categories in constant order, each on a bot table with a visible column", () => {
    expect(Object.keys(WIKI_REGISTRY)).toEqual(WIKI_CATEGORIES.map(c => c.name));
    const botTables = new Set(Object.values(botSchema).filter(v => typeof v === "object"));
    for (const { name, label } of WIKI_CATEGORIES) {
      const spec = WIKI_REGISTRY[name];
      expect(spec.label).toBe(label);
      expect(spec.idColumn).toBe("id");
      expect(botTables.has(spec.table as never)).toBe(true);
      const config = getTableConfig(spec.table);
      expect(config.schema).toBe("bot");
      const columnNames = config.columns.map(c => c.name);
      expect(columnNames).toContain("visible");
      expect(columnNames).toContain("id");
      expect(spec.searchColumns.length).toBeGreaterThan(0);
      expect(spec.omitColumns).toContain("visible");
      const keys = Object.keys(spec.table as object);
      for (const col of spec.searchColumns) expect(keys).toContain(col);
      if (spec.slugColumn) expect(keys).toContain(spec.slugColumn);
    }
  });

  test("slug columns", () => {
    for (const { name } of WIKI_CATEGORIES) {
      if (NO_SLUG.has(name)) expect(WIKI_REGISTRY[name].slugColumn).toBeNull();
      else expect(WIKI_REGISTRY[name].slugColumn).toBe("slug");
    }
  });
});

describe("wiki read repository SQL", () => {
  const compiled = Object.fromEntries(Object.entries(drivers).map(([driver, db]) => [driver, compileAll(db)]));

  test("every query binds visible = true and never selects it", () => {
    for (const queries of Object.values(compiled)) {
      for (const q of Object.values(queries)) assertVisibleBound(q);
    }
  });

  test("SQL text and params identical across postgres-js and bun-sql", () => {
    expect(compiled["bun-sql"]).toEqual(compiled["postgres-js"]!);
  });

  test("search is an ILIKE over the search columns with escaped metacharacters", () => {
    const q = compiled["postgres-js"]!["techniques:list-q"]!;
    expect(q.sql.match(/ ilike /g)?.length).toBe(WIKI_REGISTRY.techniques.searchColumns.length);
    expect(q.params).toContain("%Son 50\\%\\_%");
    expect(q.sql).toMatch(/order by "bot"\."db_techniques"\."id" asc limit \$\d+$/);
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  test("idOrSlug: numeric by id, otherwise slug when the table has one", () => {
    const q = wikiQueries(drivers["postgres-js"]!);
    const byId = q.get("races", "7")!.toSQL();
    expect(byId.sql).toContain('"bot"."db_races"."id" = $');
    expect(byId.params).toContain(7);
    const bySlug = q.get("races", "saiyan")!.toSQL();
    expect(bySlug.sql).toContain('"bot"."db_races"."slug" = $');
    expect(bySlug.params).toContain("saiyan");
    expect(q.get("characters", "goku")).toBeNull();
    expect(q.get("wishes", "")).toBeNull();
  });

  test("limit clamped to 200", () => {
    const q = wikiQueries(drivers["postgres-js"]!);
    const sql = q.list({ category: "items", limit: 10_000, offset: -3 }).toSQL();
    expect(sql.params).toEqual([true, 200]);
    const paged = q.list({ category: "items", limit: 5, offset: 40 }).toSQL();
    expect(paged.params).toEqual([true, 5, 40]);
  });

  test("stream columns are not public", () => {
    const q = wikiQueries(drivers["postgres-js"]!);
    const sql = q.list({ category: "episodes", limit: 1, offset: 0 }).toSQL().sql;
    expect(sql).not.toContain('"stream_headers"');
    expect(sql).toContain('"title"');
  });
});

describe("wiki read repository results", () => {
  test("no response row exposes visible", async () => {
    const row = { id: 1, name: "Goku", visible: true, streamHeaders: { a: "b" } };
    expect(toPublicRow(WIKI_REGISTRY.characters, row)).toEqual({
      id: 1,
      name: "Goku",
      streamHeaders: { a: "b" },
    });
    expect(toPublicRow(WIKI_REGISTRY.episodes, row)).toEqual({ id: 1, name: "Goku" });

    // Executing repository over a promise-backed fake: every builder resolves to rows with `visible`.
    const rows = [{ id: 3, name: "Vegeta", visible: true }];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "from", "where", "orderBy", "limit", "offset"]) {
      chain[m] = () => chain;
    }
    let totalMode = false;
    chain.select = (fields: Record<string, unknown>) => {
      totalMode = Object.keys(fields).length === 1 && "total" in fields;
      const mode = totalMode;
      const local = Object.assign(Promise.resolve(mode ? [{ total: 1 }] : rows), {}) as Promise<unknown[]> &
        Record<string, unknown>;
      for (const m of ["from", "where", "orderBy", "limit", "offset"]) local[m] = () => local;
      return local;
    };
    const repo = createWikiReadRepository(chain as unknown as ShenronPgDatabase);
    const list = await repo.list({ category: "characters", limit: 10, offset: 0 });
    expect(list).toEqual({ items: [{ id: 3, name: "Vegeta" }], total: 1 });
    expect(await repo.get({ category: "characters", idOrSlug: "3" })).toEqual({
      id: 3,
      name: "Vegeta",
    });
    expect(await repo.get({ category: "characters", idOrSlug: "vegeta" })).toBeNull();
    const categories = await repo.categories();
    expect(categories).toHaveLength(21);
    expect(categories[0]).toEqual({ name: "characters", label: "Personnages", total: 1 });
  });
});
