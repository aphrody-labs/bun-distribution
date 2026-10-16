import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Button } from "../src/components/button";
import { Badge } from "../src/components/badge";
import { breakpointForWidth } from "../src/hooks/use-mobile";
import { classifyWidth } from "@aphrody/m3-tokens/breakpoints";

test("Base UI button retains semantic button and disabled behavior during SSR", () => {
  const html = renderToStaticMarkup(createElement(Button, { disabled: true, children: "Save" }));
  expect(html).toContain("<button");
  expect(html).toContain("disabled");
  expect(html).toContain("Save");
  expect(html).not.toContain("<button><button");
});

test("asChild preserves the consumer element without a nested button", () => {
  const html = renderToStaticMarkup(
    createElement(Button, { asChild: true }, createElement("a", { href: "/reader" }, "Read")),
  );
  expect(html).toContain('href="/reader"');
  expect(html).toContain("Read");
  expect(html).not.toContain("<button");
});

test("badge keeps its content and responsive classes share the canonical owner", () => {
  const html = renderToStaticMarkup(createElement(Badge, {}, "Ready"));
  expect(html).toContain("Ready");
  expect(html).toContain('data-slot="badge"');
  expect(breakpointForWidth).toBe(classifyWidth);
});
