// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FileThumb, GridItem, RenameInput, TagPill } from "../src/index";

describe("crawlable SSR markup (m3-explorer)", () => {
  test("a grid item is a named button with deterministic hooks, thumbnails are decorative", () => {
    const html = renderToStaticMarkup(
      <GridItem
        name="Report"
        extension="pdf"
        sizeText="1 MB"
        thumb={{ iconSrc: "/i.svg" }}
        tags={[{ color: "#f00", name: "Important" }]}
      />,
    );
    expect(html).toContain('<button type="button"');
    expect(html).toContain('data-m3-component="GridItem"');
    expect(html).toContain('data-testid="grid-item-Report.pdf"');
    expect(html).toContain("Report.pdf");
    expect(html).toContain('alt=""');
    expect(html).toContain('title="Report.pdf"');
  });

  test("tag chips, thumbnails and the rename field carry hooks", () => {
    expect(renderToStaticMarkup(<TagPill color="#0f0">Done</TagPill>)).toContain('data-m3-component="TagPill"');
    expect(renderToStaticMarkup(<FileThumb iconSrc="/f.svg" size={48} />)).toContain('data-m3-component="FileThumb"');
    const rename = renderToStaticMarkup(<RenameInput name="Projects" onSave={async () => {}} onCancel={() => {}} />);
    expect(rename).toContain('data-m3-component="RenameInput"');
    expect(rename).toContain('aria-label="Name"');
  });
});
