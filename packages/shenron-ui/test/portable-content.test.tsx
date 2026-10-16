import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  JsonLd,
  Markdown,
  safeMarkdownHref,
  VideoSourceSummary,
} from "../src/server";

describe("portable content helpers", () => {
  test("escapes inline JSON-LD script delimiters", () => {
    const html = renderToStaticMarkup(
      <JsonLd
        data={{ "@context": "https://schema.org", name: "</script><img>" }}
      />,
    );
    expect(html).toContain("\\u003c/script\\u003e\\u003cimg\\u003e");
    expect(html).not.toContain("<img>");
  });

  test("keeps only safe Markdown link protocols", () => {
    expect(safeMarkdownHref("/wiki/goku")).toBe("/wiki/goku");
    expect(safeMarkdownHref("https://example.test")).toBe(
      "https://example.test",
    );
    expect(safeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    const html = renderToStaticMarkup(
      <Markdown>[unsafe](javascript:alert(1))</Markdown>,
    );
    expect(html).not.toContain("href=");
  });

  test("renders a source summary solely from the supplied host contract", () => {
    const html = renderToStaticMarkup(
      <VideoSourceSummary
        players={[{ provider: "Capsule", lang: "vostfr" }]}
      />,
    );
    expect(html).toContain("Capsule");
    expect(html).toContain("VOSTFR");
  });
});
