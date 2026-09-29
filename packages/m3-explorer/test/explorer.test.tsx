// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FileThumb, GridItem, RenameInput, TagPill } from "../src/index";

const SPACEUI_VOCABULARY = /\b(bg|text|border)-(app|ink|sidebar|menu|accent)\b/;

function expectM3(html: string) {
  expect(html).not.toMatch(SPACEUI_VOCABULARY);
  expect(html).not.toContain("text-white");
  expect(html).not.toContain("brightness-");
}

describe("TagPill", () => {
  test("is an M3 chip with the tag color kept on the dot", () => {
    const html = renderToStaticMarkup(<TagPill color="#ef4444">Important</TagPill>);
    expect(html).toContain("rounded-small");
    expect(html).toContain("border-outline-variant");
    expect(html).toContain("text-label-large");
    expect(html).toContain("text-on-surface-variant");
    expect(html).toContain("background-color:#ef4444");
    expect(html).toContain('type="button"');
    expectM3(html);
  });

  test("md is the 32dp baseline; remove shows a close icon", () => {
    const html = renderToStaticMarkup(
      <TagPill color="#22c55e" size="md" onRemove={() => {}}>
        Done
      </TagPill>,
    );
    expect(html).toContain("h-8");
    expect(html).toContain(">close</span>");
    expect(html).toContain("hover:bg-on-surface/8");
    // The remove control is its own native button, a sibling of the chip button.
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Remove"');
    expect(html).not.toContain('role="button"');
    expectM3(html);
  });

  test("selected uses the secondary container", () => {
    const html = renderToStaticMarkup(
      <TagPill color="#3b82f6" selected onClick={() => {}}>
        Work
      </TagPill>,
    );
    expect(html).toContain("bg-secondary-container text-on-secondary-container");
    expect(html).toContain("border-transparent");
    expect(html).toContain('aria-pressed="true"');
    expectM3(html);
  });
});

describe("RenameInput", () => {
  test("is an M3 inline text field with the extension as suffix", () => {
    const html = renderToStaticMarkup(
      <RenameInput name="report" extension="pdf" onSave={async () => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("bg-surface-container-highest");
    expect(html).toContain("rounded-extra-small");
    expect(html).toContain("outline-primary");
    expect(html).toContain("text-body-medium");
    expect(html).toContain('value="report"');
    expect(html).toContain(">.pdf</span>");
    expectM3(html);
  });
});

describe("FileThumb", () => {
  test("renders the kind icon and a framed thumbnail", () => {
    const html = renderToStaticMarkup(
      <FileThumb
        iconSrc="/icons/Image.png"
        thumbnailSrc={{ src: "/thumbs/a.jpg" }}
        size={120}
        selected
      />,
    );
    expect(html).toContain('src="/icons/Image.png"');
    expect(html).toContain('src="/thumbs/a.jpg"');
    expect(html).toContain("rounded-small");
    expect(html).toContain("bg-surface-container-high");
    expect(html).toContain("outline-primary");
    expectM3(html);
  });

  test("small thumbs keep the scaled radius", () => {
    const html = renderToStaticMarkup(
      <FileThumb iconSrc="/i.png" thumbnailSrc="/t.jpg" size={40} />,
    );
    expect(html).toContain("border-radius:3.2px");
  });
});

describe("GridItem", () => {
  const thumb = { iconSrc: "/icons/Document.png" };

  test("is a medium-corner tile with a state layer", () => {
    const html = renderToStaticMarkup(
      <GridItem name="notes" extension="md" sizeText="2 KB" thumb={thumb} />,
    );
    expect(html).toContain("rounded-medium");
    expect(html).toContain("hover:before:opacity-8");
    expect(html).toContain("text-label-medium");
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("notes.md");
    expect(html).toContain("focus-visible:outline-secondary");
    expectM3(html);
  });

  test("selected uses the secondary container and its on-color", () => {
    const html = renderToStaticMarkup(
      <GridItem
        name="photo"
        selected
        thumb={thumb}
        tags={[
          { name: "a", color: "#f00" },
          { name: "b", color: "#0f0" },
          { name: "c", color: "#00f" },
          { name: "d", color: "#ff0" },
        ]}
      />,
    );
    expect(html).toContain("bg-secondary-container");
    expect(html).toContain("text-on-secondary-container");
    expect(html).toContain(">+1</span>");
    expectM3(html);
  });
});
