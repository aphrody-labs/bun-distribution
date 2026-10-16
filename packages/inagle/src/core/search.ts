/**
 * Compatibility facade for the canonical fuzzy search engine.
 *
 * Provides fast fuzzy search across game data
 */

import { createSearchIndex as createCanonicalSearchIndex } from "../search/fuzzy.js";

/**
 * Searchable item interface
 */
export interface SearchableItem {
  id: string | number;
  text: string;
  [key: string]: unknown;
}

/**
 * Search result with match info
 */
export interface SearchResult<T> {
  item: T;
  score: number;
  matches: [number, number][]; // [start, length] pairs
}

/**
 * Create a search index for a list of items
 */
export function createSearchIndex<T extends SearchableItem>(
  items: T[],
  textGetter: (item: T) => string = (item) => item.text,
): {
  search: (query: string, limit?: number) => SearchResult<T>[];
  items: T[];
} {
  const canonical = createCanonicalSearchIndex(items, textGetter);

  return {
    items,
    search(query: string, limit = 20): SearchResult<T>[] {
      return canonical.search(query, { limit }).map((result) => ({
        item: result.item,
        score: 1 - result.score,
        matches: Array.from({ length: Math.floor(result.matches.length / 2) }, (_, index) => {
          const start = result.matches[index * 2]!;
          const end = result.matches[index * 2 + 1]!;
          return [start, end - start] as [number, number];
        }),
      }));
    },
  };
}

/**
 * Simple exact/prefix search (faster for exact matches)
 */
export function exactSearch<T>(items: T[], query: string, textGetter: (item: T) => string): T[] {
  const lowerQuery = query.toLowerCase();
  return items.filter((item) => textGetter(item).toLowerCase().includes(lowerQuery));
}

/**
 * Search with multiple fields
 */
export function multiFieldSearch<T>(
  items: T[],
  query: string,
  fieldGetters: ((item: T) => string)[],
): T[] {
  const lowerQuery = query.toLowerCase();
  return items.filter((item) =>
    fieldGetters.some((getter) => getter(item).toLowerCase().includes(lowerQuery)),
  );
}
