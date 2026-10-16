// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { M3IconSvg } from "../src/browser.tsx";

const SVG = '<svg viewBox="0 -960 960 960"><path d="M0 0h1v1z"/></svg>';

describe("<M3IconSvg> (browser entry)", () => {
  test("renders pre-generated SVG without a native binding", () => {
    const markup = renderToString(React.createElement(M3IconSvg, { svg: SVG }));
    expect(markup).toContain("<svg");
    expect(markup).toContain('aria-hidden="true"');
  });

  test("is accessible when a title is given", () => {
    const markup = renderToString(
      React.createElement(M3IconSvg, { svg: SVG, title: "Home" }),
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Home"');
  });

  test("source graph never imports @aphrody/bun", async () => {
    const src = await Bun.file(
      new URL("../src/browser.tsx", import.meta.url),
    ).text();
    expect(src).not.toMatch(/from\s+["']@aphrody\/bun["']/);
  });
});

describe("<m3-icon-svg> (Lit browser entry)", () => {
  test("renders pre-generated SVG into light DOM", async () => {
    await import("../src/browser-lit.ts");
    const el = document.createElement("m3-icon-svg");
    el.svg = SVG;
    el.title = "Home";
    document.body.append(el);
    await el.updateComplete;
    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Home",
    );
    el.remove();
  });
});
