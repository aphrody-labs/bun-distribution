// SPDX-License-Identifier: Apache-2.0
/**
 * B15 — Base UI 1.8 state attributes. The wrappers must target the attributes
 * Base UI actually renders (`data-open` / `data-panel-open` on the accordion,
 * `data-active` on tabs), never the pre-1.0 `data-expanded` / `data-selected`.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
	Accordion,
	AccordionItem,
	AccordionPanel,
	AccordionTrigger,
} from "../src/components/accordion";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../src/components/tabs";

const srcDir = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

describe("Base UI 1.8 selectors", () => {
	test("no data-[expanded] or data-[selected] in packages/shenron-ui/src", async () => {
		const files = await Array.fromAsync(new Glob("**/*.{ts,tsx,css}").scan({ cwd: srcDir }));
		expect(files.length).toBeGreaterThan(0);
		const hits: string[] = [];
		for (const f of files) {
			const text = await Bun.file(`${srcDir}${f}`).text();
			if (/data-\[expanded\]|data-expanded|data-\[selected\]|data-selected/.test(text))
				hits.push(f);
		}
		expect(hits).toEqual([]);
	});

	test("open accordion renders data-open on the item and data-panel-open on the trigger", () => {
		const html = renderToStaticMarkup(
			h(
				Accordion,
				{ defaultValue: ["a"] },
				h(
					AccordionItem,
					{ value: "a" },
					h(AccordionTrigger, null, "Titre"),
					h(AccordionPanel, null, "Contenu")
				),
				h(
					AccordionItem,
					{ value: "b" },
					h(AccordionTrigger, null, "Autre"),
					h(AccordionPanel, null, "Caché")
				)
			)
		);
		expect(html).toContain("data-open");
		expect(html).toContain("data-panel-open");
		expect(html).toContain("data-open:border-dbz-orange/80");
		expect(html).toContain("[&amp;[data-panel-open]&gt;svg]:rotate-180");
		expect(html).not.toContain("data-expanded");
	});

	test("selected tab renders data-active, targeted by the tab classes", () => {
		const html = renderToStaticMarkup(
			h(
				Tabs,
				{ defaultValue: "one" },
				h(TabsList, null, h(TabsTab, { value: "one" }, "Un"), h(TabsTab, { value: "two" }, "Deux")),
				h(TabsPanel, { value: "one" }, "Panneau")
			)
		);
		const tabs = html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
		expect(tabs.length).toBe(2);
		expect(tabs.filter((t) => /\sdata-active(=|\s|>)/.test(t)).length).toBe(1);
		expect(html).toContain("data-active:bg-dbz-orange");
		expect(html).not.toContain("data-selected");
	});
});
