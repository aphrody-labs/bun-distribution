// SPDX-License-Identifier: Apache-2.0
/**
 * Single parser for comic.dragonballcn.com volume galleries (`/list/gain_1.php?did=…`).
 *
 * The crawl script and the parallel dump worker both read the same page; they must
 * agree on which plates it lists, so the extraction lives here only.
 */

export const DRAGONBALLCN_BASE_URL = "https://comic.dragonballcn.com";

const THUMB_PATTERN = /\/list\/\/?([^"]+?)\/_thumb\.([^"/]+?)(?:")/g;

export interface GalleryListing {
	/** Page `<title>` without the site suffix, or null when absent. */
	title: string | null;
	/** Directory of the first thumbnail, under `/list/`. */
	directory?: string;
	/** Plate file names in page order, without duplicates. */
	files: string[];
}

export interface GalleryPage {
	pageNumber: number;
	name: string;
	thumbUrl: string;
	imageUrl: string;
	pageUrl: string;
}

export function parseGalleryTitle(html: string): string | null {
	const raw = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
	return raw === undefined ? null : raw.replace(/\s*-\s*.*$/, "").trim();
}

function galleryEntries(html: string): Array<{ dir: string; file: string }> {
	const entries: Array<{ dir: string; file: string }> = [];
	const seen = new Set<string>();
	for (const m of html.matchAll(THUMB_PATTERN)) {
		const file = m[2] as string;
		if (seen.has(file)) continue;
		seen.add(file);
		entries.push({ dir: m[1] as string, file });
	}
	return entries;
}

export function parseGalleryListing(html: string): GalleryListing {
	const entries = galleryEntries(html);
	const listing: GalleryListing = { title: parseGalleryTitle(html), files: entries.map((e) => e.file) };
	if (entries[0]) listing.directory = entries[0].dir;
	return listing;
}

/** Full page records (thumbnail, full image and viewer URLs) for a volume. */
export function parseGalleryPages(
	html: string,
	did: string,
	baseUrl: string = DRAGONBALLCN_BASE_URL
): { title: string; totalPages: number; pages: GalleryPage[] } {
	const pages = galleryEntries(html).map(({ dir, file }, i) => ({
		pageNumber: i + 1,
		name: file,
		thumbUrl: `${baseUrl}/list/${dir}/_thumb.${file}`,
		imageUrl: `${baseUrl}/list/${dir}/${file}`,
		pageUrl: `${baseUrl}/list/gain_1.php?did=${encodeURIComponent(did)}#page_${i + 1}`,
	}));
	return { title: parseGalleryTitle(html) ?? "", totalPages: pages.length, pages };
}
