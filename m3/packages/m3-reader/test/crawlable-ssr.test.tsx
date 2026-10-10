// SPDX-License-Identifier: Apache-2.0
// Crawlability of the readers' server-rendered markup (needs test/setup.ts for swiper).

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CollectionReader } from "../src/CollectionReader";
import { MangaReader } from "../src/MangaReader";

const labels = {
  emptyLabel: "Empty",
  contentsLabel: "Contents",
  previousLabel: "Previous",
  nextLabel: "Next",
};
const editions = [
  { id: "v1", label: "Volume 1", chapters: [{ id: 1, label: "Chapter 1", pageCount: 3 }] },
];

describe("crawlable SSR markup (m3-reader)", () => {
  test("CollectionReader is a named region with hooks and no dangling aria-controls", () => {
    const html = renderToStaticMarkup(
      <CollectionReader
        title="Collection"
        editions={editions}
        {...labels}
        renderChapter={() => <p>body</p>}
      />,
    );
    expect(html).toContain('aria-label="Collection"');
    expect(html).toContain('data-m3-component="CollectionReader"');
    expect(html).toContain('data-testid="collection-reader"');
    expect(html).not.toContain("aria-controls"); // the contents panel is not mounted while closed
  });

  test("MangaReader is a labelled region whose pages are images with alternatives and whose chapter links are real", () => {
    const html = renderToStaticMarkup(
      <MangaReader title="Chapter 1" pages={["a.jpg", "b.jpg"]} prevHref="/c/0" nextHref="/c/2" />,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Chapter 1"');
    expect(html).toContain('data-m3-component="MangaReader"');
    expect(html).toContain('data-testid="manga-reader"');
    expect(html).toContain('alt="Chapter 1 — page 1"');
    expect(html).toContain('href="/c/0"');
    expect(html).toContain('href="/c/2"');
  });
});
