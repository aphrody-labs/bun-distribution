// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexChat, promptBarShape } from "./codex-chat";
import { Rail } from "./rail-drawer";

const appCss = await Bun.file(new URL("./app.css", import.meta.url)).text();
const chatSrc = await Bun.file(new URL("./codex-chat.tsx", import.meta.url)).text();

const baseProps = {
  turns: [],
  busy: false,
  draft: "",
  onDraftChange: () => {},
  onSend: () => {},
  onStop: () => {},
  onNewSession: () => {},
  onClearSession: () => {},
  model: "m",
  onModelChange: () => {},
  modelOptions: [],
  cwd: "/tmp",
  onCwdChange: () => {},
};

describe("Gemini prompt bar", () => {
  test("corner state follows content and conversation", () => {
    expect(promptBarShape({ hasTurns: false, scrolled: false, hasContent: false })).toBe("empty");
    expect(promptBarShape({ hasTurns: false, scrolled: false, hasContent: true })).toBe("content");
    expect(promptBarShape({ hasTurns: true, scrolled: false, hasContent: true })).toBe("docked");
    expect(promptBarShape({ hasTurns: false, scrolled: true, hasContent: false })).toBe("docked");
  });

  test("CSS maps each state to the brand corner tokens", () => {
    expect(appCss).toContain("border-radius: var(--app-shape-prompt-empty);");
    expect(appCss).toMatch(
      /\.app-prompt-bar\[data-shape="content"\]\s*\{\s*border-radius:\s*var\(--app-shape-prompt-content\);\s*\}/,
    );
    expect(appCss).toMatch(
      /\.app-prompt-bar\[data-shape="docked"\]\s*\{\s*border-radius:\s*var\(--app-shape-prompt-docked\);\s*\}/,
    );
    expect(appCss).toContain("border: 1px solid var(--md-sys-color-outline-variant);");
    expect(appCss).toMatch(
      /field-sizing:\s*content;\s*height:\s*auto;\s*min-block-size:\s*1lh;\s*max-block-size:\s*10lh;/,
    );
    expect(appCss).toContain("border-radius: var(--app-shape-chip);");
  });

  test("first launch shows the gradient greeting and an empty-shape prompt bar", () => {
    const html = renderToStaticMarkup(createElement(CodexChat, baseProps));
    expect(html).toContain('class="app-greeting"');
    // Greeting is not a message: no copy, dislike or fork actions; sparkle sits inside the heading.
    const feed = html.slice(html.indexOf("app-reading-column"), html.indexOf("app-prompt-bar"));
    expect(feed).not.toContain("content_copy");
    expect(feed).not.toContain("thumb_down");
    expect(feed).not.toContain("call_split");
    expect(html).toMatch(/<h2 class="app-greeting"><svg class="app-sparkle"/);
    expect(html).toContain('data-shape="empty"');
    expect(html).toContain("app-reading-column");
  });
});

describe("Gemini layout invariants", () => {
  test("title gradient is used only by the greeting and the sparkle mark", () => {
    const uses = appCss.match(/var\(--app-title-gradient\)/g) ?? [];
    expect(uses.length).toBe(1);
    const greeting = appCss.slice(appCss.indexOf(".app-greeting-text {"));
    expect(greeting.slice(0, greeting.indexOf("}"))).toContain("var(--app-title-gradient)");
    expect(chatSrc.match(/TITLE_GRADIENT_STOPS/g)?.length).toBe(3); // import + two uses inside SparkleMark
  });

  test("springs drive only user-triggered morphs, with fallback and reduced motion", () => {
    const supports = appCss.slice(
      appCss.indexOf("@supports (transition-timing-function: linear(0, 1))"),
    );
    expect(supports).toContain("var(--app-motion-spring-default-spatial)");
    expect(
      appCss.indexOf("cubic-bezier(0.2, 0, 0, 1);\n}\n.app-prompt-bar[data-shape"),
    ).toBeGreaterThan(0);
    const reduced = appCss.slice(appCss.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".app-prompt-bar");
    expect(reduced).toMatch(/\.app-rail-panel\s*\{\s*transition:\s*none;\s*\}/);
    expect(appCss).toContain("@supports (animation-timeline: scroll())");
  });

  test("shape tokens are loaded so rounded-full and the typescale resolve", () => {
    expect(appCss.indexOf('@import "@aphrody/m3-tokens/m3-tokens.css"')).toBeGreaterThan(0);
    expect(appCss.indexOf('@import "@aphrody/m3-tokens/m3-tokens.css"')).toBeLessThan(
      appCss.indexOf('@import "./brand.css"'),
    );
  });

  test("greeting uses a display size on the h2, not the body role or the 18px floor", () => {
    const block = appCss.slice(appCss.indexOf(".app-greeting {"));
    const rule = block.slice(0, block.indexOf("}"));
    expect(rule).toContain("font-size: clamp(2rem, 4vw, 2.8rem);");
    expect(rule).toContain("font-weight: var(--app-weight-display);");
    expect(rule).not.toMatch(/body/);
    const text = appCss.slice(appCss.indexOf(".app-greeting-text {"));
    expect(text.slice(0, text.indexOf("}"))).toContain("font-size: 1em;");
    expect(appCss).toContain('font-variation-settings: "ROND" 100;');
    // h2 is outside the LOW_VISION :where() list, so the span's max(18px, 1em) resolves to the display size.
    expect(appCss).not.toMatch(/#root :where\([^)]*h2/);
  });

  test("chips never wrap and collapse to icons on narrow windows", () => {
    expect(appCss).toContain("white-space: nowrap;\n  border-radius: var(--app-shape-chip);");
    expect(appCss).toMatch(
      /@media \(max-width: 839px\) \{\n  \.app-chip-label \{[^}]*clip-path: inset\(50%\)/,
    );
    expect(chatSrc).toContain("Niveau d'accès : ");
    expect(chatSrc).toContain("app-chip-label font-semibold");
  });

  test("LOW_VISION 18px floor stays in place", () => {
    expect(appCss).toContain("font-size: max(var(--aphrody-base-font-size, 18px), 1em);");
  });

  test("rail is inert and collapsed when hidden", () => {
    const closed = renderToStaticMarkup(
      createElement(Rail, { expanded: false, label: "Rail" }, "x"),
    );
    expect(closed).toContain('data-expanded="false"');
    expect(closed).toContain("inert");
    const open = renderToStaticMarkup(createElement(Rail, { expanded: true, label: "Rail" }, "x"));
    expect(open).toContain('data-expanded="true"');
    expect(open).not.toContain("inert");
  });
});
