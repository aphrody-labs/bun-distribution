// Source: packages/shenron/db/src/repos/wiki.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Public wiki read repository over PostgreSQL `bot.*` (query builder only).
 * Every query carries `visible = true`; `visible` (and the category's other
 * omitted columns) is never selected. Runtime class: `pure`.
 */
import { and, asc, count, eq, getTableColumns, ilike, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { WIKI_CATEGORIES, type WikiCategoryName } from "../constants";
import type { ShenronPgDatabase } from "../types";
import { WIKI_REGISTRY, type WikiCategorySpec } from "../wiki-registry";

export interface WikiCategorySummary {
  name: WikiCategoryName;
  label: string;
  total: number;
}

export interface WikiListInput {
  category: WikiCategoryName;
  limit: number;
  offset: number;
  q?: string;
}

export const WIKI_LIST_DEFAULT_LIMIT = 50;
export const WIKI_LIST_MAX_LIMIT = 200;

// oxlint-disable-next-line no-explicit-any -- repositories accept any Drizzle PG schema
type AnyDb = ShenronPgDatabase<any>;

function spec(category: WikiCategoryName): WikiCategorySpec {
  const s = WIKI_REGISTRY[category];
  if (!s) throw new Error(`Catégorie wiki inconnue : ${String(category)}`);
  return s;
}

function columns(s: WikiCategorySpec): Record<string, PgColumn> {
  return getTableColumns(s.table) as Record<string, PgColumn>;
}

function column(s: WikiCategorySpec, key: string): PgColumn {
  const col = columns(s)[key];
  if (!col) throw new Error(`Colonne ${key} absente de la catégorie ${s.name}`);
  return col;
}

/** Selected columns: every table column minus `omitColumns`. */
export function publicColumns(s: WikiCategorySpec): Record<string, PgColumn> {
  const omit = new Set(s.omitColumns);
  return Object.fromEntries(Object.entries(columns(s)).filter(([key]) => !omit.has(key)));
}

/** Escapes LIKE metacharacters (PostgreSQL's default escape is backslash). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, c => `\\${c}`);
}

function visibleFilter(s: WikiCategorySpec): SQL {
  return eq(column(s, "visible"), true);
}

function searchFilter(s: WikiCategorySpec, q: string | undefined): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const pattern = `%${escapeLike(term)}%`;
  return or(...s.searchColumns.map(key => ilike(column(s, key), pattern)));
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return WIKI_LIST_DEFAULT_LIMIT;
  return Math.min(WIKI_LIST_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function clampOffset(offset: number): number {
  return Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
}

/** Strips omitted columns from a row (defence in depth). */
export function toPublicRow(s: WikiCategorySpec, row: Record<string, unknown>): Record<string, unknown> {
  const omit = new Set(s.omitColumns);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !omit.has(key)));
}

/** Query builders, exposed for `.toSQL()` inspection. */
export function wikiQueries(db: AnyDb) {
  return {
    count(category: WikiCategoryName, q?: string) {
      const s = spec(category);
      return db
        .select({ total: count() })
        .from(s.table)
        .where(and(visibleFilter(s), searchFilter(s, q)));
    },
    list(input: WikiListInput) {
      const s = spec(input.category);
      return db
        .select(publicColumns(s))
        .from(s.table)
        .where(and(visibleFilter(s), searchFilter(s, input.q)))
        .orderBy(asc(column(s, s.idColumn)))
        .limit(clampLimit(input.limit))
        .offset(clampOffset(input.offset));
    },
    /** null when `idOrSlug` is not numeric and the table has no slug column. */
    get(category: WikiCategoryName, idOrSlug: string) {
      const s = spec(category);
      const key = idOrSlug.trim();
      let match: SQL;
      if (/^\d+$/.test(key)) match = eq(column(s, s.idColumn), Number(key));
      else if (s.slugColumn && key) match = eq(column(s, s.slugColumn), key);
      else return null;
      return db
        .select(publicColumns(s))
        .from(s.table)
        .where(and(visibleFilter(s), match))
        .limit(1);
    },
  };
}

export function createWikiReadRepository(db: AnyDb) {
  const queries = wikiQueries(db);
  return {
    async categories(): Promise<WikiCategorySummary[]> {
      return Promise.all(
        WIKI_CATEGORIES.map(async ({ name, label }) => {
          const [row] = await queries.count(name);
          return { name, label, total: Number(row?.total ?? 0) };
        }),
      );
    },
    async list(input: WikiListInput): Promise<{ items: Record<string, unknown>[]; total: number }> {
      const s = spec(input.category);
      const [rows, totals] = await Promise.all([queries.list(input), queries.count(input.category, input.q)]);
      return {
        items: (rows as Record<string, unknown>[]).map(row => toPublicRow(s, row)),
        total: Number(totals[0]?.total ?? 0),
      };
    },
    async get(input: { category: WikiCategoryName; idOrSlug: string }): Promise<Record<string, unknown> | null> {
      const s = spec(input.category);
      const query = queries.get(input.category, input.idOrSlug);
      if (!query) return null;
      const [row] = (await query) as Record<string, unknown>[];
      return row ? toPublicRow(s, row) : null;
    },
  };
}

export type WikiReadRepository = ReturnType<typeof createWikiReadRepository>;
