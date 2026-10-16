import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_PAGINATION_LABELS, Pagination, pagesVisibles } from "../src/components/pagination";
import { pageWindow } from "../src/lib/page-window";

// Expected markup captured from apps/shenron/site/src/components/ui/Pagination.tsx
// before it became a wrapper over @shenron/ui (wave 3, W3-UI-02); focus ring
// since moved from box-shadow ring to outline (design rule: no drop shadow).
const BEFORE = {
	p1: '<div class="flex flex-col items-center gap-3 "><p class="font-scouter text-[11px] tabular-nums text-white/45">1–120 sur 1 307 fiches</p><nav aria-label="Pagination" class="flex max-w-full flex-wrap items-center justify-center gap-1"><button type="button" disabled="" aria-label="Page précédente" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 text-white/70 hover:bg-white/[0.06] hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" aria-hidden="true" class="h-4 w-4"><path d="M 15.5 4.5 L 8 12 L 15.5 19.5"></path></svg></button><button type="button" aria-current="page" aria-label="Page 1" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums bg-dbz-orange text-black">1</button><button type="button" aria-label="Page 2" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">2</button><button type="button" aria-label="Page 3" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">3</button><button type="button" aria-label="Page 4" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">4</button><span aria-hidden="true" class="grid h-11 w-5 place-items-center text-white/30">…</span><button type="button" aria-label="Page 11" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">11</button><button type="button" aria-label="Page suivante" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 text-white/70 hover:bg-white/[0.06] hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" aria-hidden="true" class="h-4 w-4"><path d="M 8.5 4.5 L 16 12 L 8.5 19.5"></path></svg></button></nav></div>',
	p6: '<div class="flex flex-col items-center gap-3 mt-4"><p class="font-scouter text-[11px] tabular-nums text-white/45">51–60 sur 105 résultats</p><nav aria-label="Pagination" class="flex max-w-full flex-wrap items-center justify-center gap-1"><button type="button" aria-label="Page précédente" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 text-white/70 hover:bg-white/[0.06] hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" aria-hidden="true" class="h-4 w-4"><path d="M 15.5 4.5 L 8 12 L 15.5 19.5"></path></svg></button><button type="button" aria-label="Page 1" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">1</button><span aria-hidden="true" class="grid h-11 w-5 place-items-center text-white/30">…</span><button type="button" aria-label="Page 5" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">5</button><button type="button" aria-current="page" aria-label="Page 6" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums bg-dbz-orange text-black">6</button><button type="button" aria-label="Page 7" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">7</button><span aria-hidden="true" class="grid h-11 w-5 place-items-center text-white/30">…</span><button type="button" aria-label="Page 11" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 tabular-nums text-white/70 hover:bg-white/[0.06] hover:text-white">11</button><button type="button" aria-label="Page suivante" class="grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35 text-white/70 hover:bg-white/[0.06] hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" aria-hidden="true" class="h-4 w-4"><path d="M 8.5 4.5 L 16 12 L 8.5 19.5"></path></svg></button></nav></div>',
	pone: '<div class="flex flex-col items-center gap-3 "><p class="font-scouter text-[11px] tabular-nums text-white/45">1–7 sur 7 résultats</p></div>',
} as const;

const noop = () => {};
const render = (props: Parameters<typeof Pagination>[0]) =>
	renderToStaticMarkup(createElement(Pagination, props));

describe("Pagination (@shenron/ui/pagination)", () => {
	test("markup identical to the site component for the same props", () => {
		expect(
			render({ page: 1, parPage: 120, total: 1307, onPageChange: noop, labels: { unit: "fiches" } })
		).toBe(BEFORE.p1);
		expect(
			render({ page: 6, parPage: 10, total: 105, onPageChange: noop, className: "mt-4" })
		).toBe(BEFORE.p6);
		expect(render({ page: 1, parPage: 10, total: 7, onPageChange: noop })).toBe(BEFORE.pone);
	});

	test("renders nothing for an empty list", () => {
		expect(render({ page: 1, parPage: 10, total: 0, onPageChange: noop })).toBe("");
	});

	test("labels and locale come from props", () => {
		const html = render({
			page: 2,
			parPage: 1000,
			total: 2500,
			onPageChange: noop,
			locale: "en-US",
			labels: {
				previous: "Previous page",
				next: "Next page",
				range: "{start}-{end} of {total} {unit}",
				unit: "items",
			},
		});
		expect(html).toContain("1,001-2,000 of 2,500 items");
		expect(html).toContain('aria-label="Previous page"');
		expect(html).toContain('aria-label="Next page"');
		expect(html).not.toContain("précédente");
	});

	test("defaults are the historical French strings and 44px targets", () => {
		expect(DEFAULT_PAGINATION_LABELS).toEqual({
			previous: "Page précédente",
			next: "Page suivante",
			range: "{start}–{end} sur {total} {unit}",
			unit: "résultats",
			nav: "Pagination",
		});
		expect(BEFORE.p6).toContain("h-11 min-w-11");
	});

	test("pagesVisibles is the shared page window", () => {
		expect(pagesVisibles).toBe(pageWindow);
	});
});
