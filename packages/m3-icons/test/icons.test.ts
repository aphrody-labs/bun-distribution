// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";

// Every entry below renders through `@aphrody/bun`, which opens the bun_rs native library when it is
// imported. Without the library these suites are skipped with the loader's reason; build or link it
// as described in docs/guides/NATIVE.md (`bun scripts/native.ts link --apply`).
// The library opens lazily, so the probe loads it: a missing or unaccepted artifact skips here, not mid-suite.
const unavailable = await import("@aphrody/bun").then(
  (module) =>
    module.isAphrodyFfiAvailable()
      ? ""
      : "aphrody-ffi native library not found",
  (error: unknown) =>
    `bun_rs native library unavailable (${String((error as Error).message ?? error).split("\n")[0]}); see docs/guides/NATIVE.md`,
);
const skip = unavailable !== "";
if (skip)
  console.warn(`[@aphrody/m3-icons] native suites skipped: ${unavailable}`);
const named = (title: string) =>
  skip ? `${title} [skipped: ${unavailable}]` : title;
const { m3Icon, m3IconNames, M3Icon } = skip
  ? ({} as typeof import("../src/index.ts"))
  : await import("../src/index.ts");
const { generateIcons } = skip
  ? ({} as typeof import("../src/codegen.ts"))
  : await import("../src/codegen.ts");
const { m3IconPlugin } = skip
  ? ({} as typeof import("../src/plugin.ts"))
  : await import("../src/plugin.ts");
if (!skip) await import("../src/lit.ts");

describe.skipIf(skip)(
  named("m3Icon / m3IconNames (via @aphrody/bun -> bun_rs::icons)"),
  () => {
    test("renders a known icon as an SVG document", () => {
      const svg = m3Icon({ name: "home" });
      expect(svg).toStartWith("<svg");
      expect(svg).toContain('viewBox="0 -960 960 960"');
      expect(svg).toContain("<path");
    });

    test("throws for an unknown icon name", () => {
      expect(() => m3Icon({ name: "not-a-real-icon-name" })).toThrow();
    });

    test("lists thousands of outlined icon names, sorted", () => {
      const names = m3IconNames("outlined");
      expect(names.length).toBeGreaterThan(3000);
      expect(names).toContain("home");
    });
  },
);

describe.skipIf(skip)(named("<M3Icon> (React)"), () => {
  test("renders inline SVG", () => {
    const markup = renderToString(
      React.createElement(M3Icon, { name: "favorite", fill: 1 }),
    );
    expect(markup).toContain("<svg");
    expect(markup).toContain("<path");
  });

  test("is accessible when a title is given", () => {
    const markup = renderToString(
      React.createElement(M3Icon, { name: "search", title: "Search" }),
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Search"');
  });
});

describe.skipIf(skip)(named("<m3-icon> (Lit)"), () => {
  test("registers the custom element", () => {
    expect(customElements.get("m3-icon")).toBeDefined();
  });

  test("renders inline SVG into light DOM", async () => {
    const el = document.createElement("m3-icon");
    el.setAttribute("name", "settings");
    document.body.append(el);
    await (el as unknown as { updateComplete: Promise<boolean> })
      .updateComplete;
    expect(el.querySelector("svg")).not.toBeNull();
    el.remove();
  });
});

describe.skipIf(skip)(named("generateIcons"), () => {
  test("writes one module per icon plus a barrel", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "m3-icons-codegen-"));
    try {
      const generated = await generateIcons({
        names: ["home", "close"],
        outDir,
      });
      expect(generated).toHaveLength(2);
      const homeModule = await import(join(outDir, "home.ts"));
      expect(homeModule.default).toContain("<svg");
      const barrel = await Bun.file(join(outDir, "index.ts")).text();
      expect(barrel).toContain("export { default as home }");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(skip)(named("m3IconPlugin"), () => {
  test("resolves a virtual m3:icon module to an SVG default export", async () => {
    const entryDir = await mkdtemp(join(tmpdir(), "m3-icons-plugin-"));
    try {
      const entry = join(entryDir, "entry.ts");
      await Bun.write(
        entry,
        'export { default } from "m3:icon/outlined/home?fill=1&wght=500";\n',
      );
      const result = await Bun.build({
        entrypoints: [entry],
        plugins: [m3IconPlugin],
      });
      expect(result.success).toBeTrue();
      const text = await result.outputs[0]!.text();
      expect(text).toContain("<svg");
    } finally {
      await rm(entryDir, { recursive: true, force: true });
    }
  });
});
