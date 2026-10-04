// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { M3Button, M3Checkbox, M3Switch, M3Tabs, cx } from "../src/index.tsx";

const css = readFileSync(new URL("../m3-baseui.css", import.meta.url), "utf8");

describe("m3-baseui", () => {
  test("cx drops falsy values", () => expect(cx("a", false, undefined, "b")).toBe("a b"));

  test("button carries the M3 variant class", () => {
    const html = renderToStaticMarkup(<M3Button variant="tonal">Save</M3Button>);
    expect(html).toContain("m3-bui-button m3-bui-button--tonal");
    expect(html).toContain("Save");
  });

  test("switch renders Base UI semantics with an M3 thumb", () => {
    const html = renderToStaticMarkup(<M3Switch defaultChecked />);
    expect(html).toContain("m3-bui-switch");
    expect(html).toContain("m3-bui-switch__thumb");
    expect(html).toContain('role="switch"');
  });

  test("checkbox and tabs render", () => {
    expect(renderToStaticMarkup(<M3Checkbox defaultChecked />)).toContain("m3-bui-checkbox");
    const tabs = renderToStaticMarkup(
      <M3Tabs.Root defaultValue="a">
        <M3Tabs.List>
          <M3Tabs.Tab value="a">A</M3Tabs.Tab>
        </M3Tabs.List>
        <M3Tabs.Panel value="a">panel</M3Tabs.Panel>
      </M3Tabs.Root>,
    );
    expect(tabs).toContain("m3-bui-tabs__tab");
    expect(tabs).toContain('role="tablist"');
  });

  test("stylesheet only references M3 tokens and styles every wrapper class", () => {
    for (const c of [
      "m3-bui-button",
      "m3-bui-switch",
      "m3-bui-checkbox",
      "m3-bui-tabs__tab",
      "m3-bui-tabs__indicator",
    ]) {
      expect(css).toContain(`.${c}`);
    }
    expect(css).toContain("var(--md-sys-color-primary)");
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
