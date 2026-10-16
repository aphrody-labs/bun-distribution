import type { PageMeta } from "@rosegriffon/achillea-types/domain/common";

/**
 * Lists pages still needed after the first tournament response.
 *
 * The legacy endpoint currently caps a requested `pageSize` of 50 at 25,
 * whereas the unified endpoint honours 50.  Pagination must therefore follow
 * the effective limit returned by the server, rather than the requested one.
 */
export function remainingTournamentPages(meta: PageMeta): number[] {
  const page = Math.max(1, Math.floor(meta.page ?? 1));
  const limit = Math.max(1, Math.floor(meta.limit ?? 50));
  const lastPage = Math.max(page, Math.ceil(Math.max(0, meta.total) / limit));

  return Array.from({ length: lastPage - page }, (_, index) => page + index + 1);
}
