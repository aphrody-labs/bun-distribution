// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptionedReader, type CaptionedReaderProps } from "../src/index";

test("databooks share the canonical illustrated-page reader implementation", () => {
  const props: CaptionedReaderProps = {
    title: "Illustrated reference",
    pages: [
      { number: 12, image: "data:image/svg+xml,<svg/>", text: "Verified annotation", verifiee: true },
      { number: 13, text: "Text-only annotation" },
      { number: 14 },
    ],
  };
  const html = renderToStaticMarkup(<CaptionedReader {...props} />);
  expect(html).toContain("Illustrated reference");
  // Virtual rows mount in the browser; SSR still exposes editorial numbering
  // and excludes the empty admin slot from the public page count.
  expect(html).toContain("n°12 · 1/2");
  expect(html).toContain('data-m3-component="CaptionedReader"');
});

test("illustrated-page reader skips sparse slots without losing editorial numbering", () => {
  const pages: CaptionedReaderProps["pages"] = [];
  pages.length = 3;
  pages[2] = { image: "data:image/svg+xml,<svg/>", text: "Only populated page" };
  const html = renderToStaticMarkup(<CaptionedReader title="Sparse reference" pages={pages} />);
  expect(html).toContain("n°3 · 1/1");
  expect(html).toContain("Sparse reference");
});
