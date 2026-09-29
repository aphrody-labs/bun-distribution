/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
	parseHtml,
	destroyTree,
	querySelector,
	querySelectorAll,
	htmlToMarkdown,
	extractTitle,
	stripTags,
	extractLinks,
	extractText,
	normalizeUrl,
	type DomTreePtr,
} from "@aphrody/bxc/ffi/rust-bridge";

/**
 * Executes a callback with an RAII-managed Rust DOM tree pointer,
 * guaranteeing deallocation in `finally` even if exceptions occur.
 */
export function withDomTree<T>(html: string, fn: (tree: DomTreePtr) => T): T {
	let tree: DomTreePtr | null = null;
	try {
		tree = parseHtml(html);
		return fn(tree);
	} finally {
		if (tree !== null) {
			try {
				destroyTree(tree);
			} catch {
				// Prevent masking original error if cleanup fails
			}
		}
	}
}

/**
 * Extracts multiple CSS selectors in a single batch over an HTML document using Rust FFI.
 */
export function querySelectBatch(
	html: string,
	selectors: Record<string, string>,
): Record<string, string | null> {
	return withDomTree(html, (tree) => {
		const result: Record<string, string | null> = {};
		for (const [key, selector] of Object.entries(selectors)) {
			result[key] = querySelector(tree, selector);
		}
		return result;
	});
}

/**
 * Extracts all matching elements for multiple CSS selectors using Rust FFI.
 */
export function querySelectAllBatch(
	html: string,
	selectors: Record<string, string>,
): Record<string, string[]> {
	return withDomTree(html, (tree) => {
		const result: Record<string, string[]> = {};
		for (const [key, selector] of Object.entries(selectors)) {
			result[key] = querySelectorAll(tree, selector);
		}
		return result;
	});
}

/**
 * High-speed link extraction using Rust FFI, filtering specifically for FUT entities
 * (players, SBCs, evolutions, clubs, leagues).
 */
export function extractFutLinks(
	html: string,
	baseUrl?: string,
	options: {
		filterCategory?: "players" | "sbc" | "evolutions" | "all";
	} = {},
): string[] {
	const allLinks = extractLinks(html, baseUrl);
	const cat = options.filterCategory ?? "all";
	if (cat === "all") return allLinks;

	return allLinks.filter((link) => {
		const lower = link.toLowerCase();
		switch (cat) {
			case "players":
				return lower.includes("/player") || lower.includes("/players/");
			case "sbc":
				return lower.includes("/sbc") || lower.includes("squad-building-challenge");
			case "evolutions":
				return lower.includes("/evolutions") || lower.includes("/evolution/");
			default:
				return true;
		}
	});
}

/**
 * High-fidelity HTML to Markdown conversion via Rust FFI.
 * Ideal for indexing EA Pitch Notes, FUTBin patch notes, and guides for RAG search.
 */
export function convertFutHtmlToMarkdown(html: string): {
	title: string;
	markdown: string;
} {
	const title = extractTitle(html);
	const markdown = htmlToMarkdown(html);
	return {
		title,
		markdown,
	};
}

/**
 * Fast HTML text extraction via Rust FFI, stripping HTML tags and entities.
 */
export function extractCleanFutText(html: string): string {
	return extractText(html);
}

/**
 * Normalizes a FUT URL by stripping fragments and normalizing paths via Rust FFI.
 */
export function normalizeFutUrl(url: string): string {
	return normalizeUrl(url);
}

/**
 * Parses numeric price from HTML string using multi-tier strategy:
 * 1. Rust FFI DOM query
 * 2. Bun HTMLRewriter
 * 3. Fast regex
 */
export function parseFutPriceFast(html: string, selectors: string[] = [".price-val", ".player-price", ".val"]): number {
	// Strategy 1: Rust FFI
	try {
		return withDomTree(html, (tree) => {
			for (const sel of selectors) {
				const node = querySelector(tree, sel);
				if (node) {
					const text = stripTags(node).replace(/[,\s]/g, "");
					const parsed = parseInt(text, 10);
					if (!isNaN(parsed) && parsed > 0) return parsed;
				}
			}
			return 0;
		});
	} catch {
		// Fallback to fast regex
		for (const sel of selectors) {
			const classClean = sel.replace(".", "");
			const re = new RegExp(`class=["'][^"']*${classClean}[^"']*["'][^>]*>([0-9,\\s]+)<`, "i");
			const m = html.match(re);
			if (m && m[1]) {
				const val = parseInt(m[1].replace(/[,\s]/g, ""), 10);
				if (!isNaN(val) && val > 0) return val;
			}
		}
		return 0;
	}
}

/**
 * Extracts and distinguishes both Console (PS5/PS4/Xbox) and PC transfer market prices from HTML.
 * Also computes the empirical PC price premium percent.
 */
export function parseFutPlatformPrices(html: string): {
	console: number;
	pc: number;
	/**
	 * Only set when both platform prices were actually parsed. When one side is
	 * estimated the premium would just restate the estimation multiplier, so it
	 * is left undefined rather than published as a measurement.
	 */
	pcPremiumPercent?: number;
	/** Which platform prices, if any, are estimated rather than parsed. */
	estimated?: "console" | "pc";
} {
	let consolePrice = 0;
	let pcPrice = 0;

	// 1. Check data attributes & JSON payloads
	const psAttrMatch = html.match(/data-price-(?:ps|console|xbox)=["']([0-9]+)["']/i) ||
		html.match(/["'](?:price_ps|price_console|ps_price)["']\s*:\s*([0-9]+)/i);
	if (psAttrMatch && psAttrMatch[1]) {
		consolePrice = parseInt(psAttrMatch[1], 10);
	}

	const pcAttrMatch = html.match(/data-price-pc=["']([0-9]+)["']/i) ||
		html.match(/["'](?:price_pc|pc_price)["']\s*:\s*([0-9]+)/i);
	if (pcAttrMatch && pcAttrMatch[1]) {
		pcPrice = parseInt(pcAttrMatch[1], 10);
	}

	// 2. Try selector queries via Rust FFI
	if (consolePrice === 0) {
		consolePrice = parseFutPriceFast(html, ["#ps-price", ".price-box.ps .price-val", ".ps-price", "[data-platform='ps']"]);
	}
	if (pcPrice === 0) {
		pcPrice = parseFutPriceFast(html, ["#pc-price", ".price-box.pc .price-val", ".pc-price", "[data-platform='pc']"]);
	}

	// 3. Fallback: if general price is present
	if (consolePrice === 0 && pcPrice === 0) {
		const generalPrice = parseFutPriceFast(html);
		if (generalPrice > 0) {
			consolePrice = generalPrice;
		}
	}

	// 4. If one platform price is missing, estimate it from the other. The result
	// is flagged via `estimated` so callers never mistake it for a parsed price.
	let estimated: "console" | "pc" | undefined;
	if (consolePrice > 0 && pcPrice === 0) {
		estimated = "pc";
		let pcMultiplier = 1.05;
		if (consolePrice >= 2000000) pcMultiplier = 1.28;
		else if (consolePrice >= 100000) pcMultiplier = 1.18;
		else if (consolePrice >= 10000) pcMultiplier = 1.10;
		pcPrice = Math.round((consolePrice * pcMultiplier) / 250) * 250;
	} else if (pcPrice > 0 && consolePrice === 0) {
		estimated = "console";
		let consoleDivisor = 1.05;
		if (pcPrice >= 2500000) consoleDivisor = 1.28;
		else if (pcPrice >= 120000) consoleDivisor = 1.18;
		else if (pcPrice >= 12000) consoleDivisor = 1.10;
		consolePrice = Math.round((pcPrice / consoleDivisor) / 250) * 250;
	}

	// A premium computed against an estimated side only echoes the multiplier above.
	const pcPremiumPct =
		!estimated && consolePrice > 0
			? Math.round(((pcPrice - consolePrice) / consolePrice) * 1000) / 10
			: undefined;

	return {
		console: consolePrice,
		pc: pcPrice,
		pcPremiumPercent: pcPremiumPct,
		estimated,
	};
}

