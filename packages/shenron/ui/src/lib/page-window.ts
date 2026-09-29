/**
 * Page numbers to show in a pager, `null` marking an ellipsis.
 *
 * First and last pages are always present, `radius` neighbours surround the
 * current page, and near either edge the window widens so the bar keeps a
 * constant width instead of jumping from page to page. Seven pages or fewer
 * are all listed.
 *
 * Moved verbatim from `apps/shenron/site/src/components/ui/Pagination.tsx`
 * (`pagesVisibles`), which `apps/shenron/site/src/components/kit/LinkPager.tsx`
 * duplicated as `pagerWindow`: same statements, same output for every input.
 */
export function pageWindow(current: number, total: number, radius = 1): Array<number | null> {
	if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
	const keep = new Set<number>([1, total, current]);
	for (let d = 1; d <= radius; d++) {
		if (current - d > 1) keep.add(current - d);
		if (current + d < total) keep.add(current + d);
	}
	// Constant width near the edges: otherwise the bar jumps page after page.
	if (current <= 3) [2, 3, 4].forEach((n) => n < total && keep.add(n));
	if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => n > 1 && keep.add(n));

	const sorted = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
	const out: Array<number | null> = [];
	let previous = 0;
	for (const n of sorted) {
		if (previous && n - previous > 1) out.push(null);
		out.push(n);
		previous = n;
	}
	return out;
}

/** Historical name used by the client list pager (`components/ui/Pagination.tsx`). */
export const pagesVisibles: typeof pageWindow = pageWindow;

/** Historical name used by the server link pager (`components/kit/LinkPager.tsx`). */
export const pagerWindow: typeof pageWindow = pageWindow;
