// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkAppIcons,
  checkAssets,
  isLocalRef,
  references,
} from "./check-assets.ts";

const root = mkdtempSync(join(tmpdir(), "check-assets-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const write = (path: string, text = "x") => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

describe("reference extraction", () => {
  test("code: asset imports and new URL, never strings or comments", () => {
    const refs = references(
      "a.ts",
      'import logo from "./logo.svg?url";\nimport x from "./x.ts";\n// new URL("./gone.png", import.meta.url)\nconst css = \'@import "./fonts.css";\';\nconst u = new URL("./font.woff2", import.meta.url);\n',
    ).map(([r]) => r);
    expect(refs).toEqual(["./logo.svg?url", "./font.woff2"]);
  });
  test("css: url() and @import, skipping data URIs and their inner url(#id)", () => {
    const refs = references(
      "a.css",
      '@import "./b.css";\n.a{background:url("./bg.png")}\n.b{mask:url("data:image/svg+xml,%3Csvg filter=\'url(%23n)\'%3E")}',
    ).map(([r]) => r);
    expect(refs).toEqual(["./bg.png", "./b.css"]);
  });
  test("tauri configs: bundle icons and the schema", () => {
    const refs = references(
      "src-tauri/tauri.conf.json",
      JSON.stringify({
        $schema: "./schema.json",
        bundle: { icon: ["icons/32x32.png"] },
      }),
    ).map(([r]) => r);
    expect(refs).toEqual(["icons/32x32.png", "./schema.json"]);
  });
  test("only relative files are local", () => {
    for (const ref of [
      "https://x/y.png",
      "data:image/png;base64,AA",
      "#frag",
      "/static/a.png",
      "m3:theme.css",
      "${a}.png",
    ])
      expect(isLocalRef(ref)).toBe(false);
    for (const ref of ["./a.png", "../b/c.svg", "icons/32x32.png"])
      expect(isLocalRef(ref)).toBe(true);
  });
});

describe("checkAssets and checkAppIcons on a synthetic repository", () => {
  write("package.json", "{}");
  write("apps/site/package.json", "{}");
  write(
    "apps/site/src/index.html",
    '<link rel="stylesheet" href="./styles.css"><img src="./missing.png">',
  );
  write("apps/site/src/styles.css", ".a{background:url(./bg.png)}");
  write("apps/site/src/bg.png");
  write("apps/desk/package.json", "{}");
  write(
    "apps/desk/src-tauri/tauri.conf.json",
    JSON.stringify({ bundle: { icon: ["icons/32x32.png", "icons/icon.ico"] } }),
  );
  write("apps/desk/src-tauri/icons/32x32.png");
  write("apps/desk/src-tauri/icons/icon.ico");
  write(
    "docs/guide.md",
    "![shot](./img/shot.png)\n```md\n![ignored](./in-code.png)\n```\n",
  );

  test("missing files are errors, present ones pass", () => {
    const messages = checkAssets(root).map((f) => `${f.file}: ${f.message}`);
    expect(messages).toContain(
      "apps/site/src/index.html: html ./missing.png does not exist",
    );
    expect(messages).toContain(
      "docs/guide.md: md-image ./img/shot.png does not exist",
    );
    expect(
      messages.some(
        (m) =>
          m.includes("bg.png") ||
          m.includes("styles.css") ||
          m.includes("in-code.png"),
      ),
    ).toBe(false);
  });
  test("apps need a favicon and Tauri configs the desktop icon formats", () => {
    const messages = checkAppIcons(root).map((f) => `${f.file}: ${f.message}`);
    expect(messages).toContain(
      'apps/site/src/index.html: web app entry declares no favicon (<link rel="icon">)',
    );
    expect(messages).toContain(
      "apps/desk/src-tauri/tauri.conf.json: bundle.icon has no .icns icon",
    );
    expect(
      messages.some((m) => m.includes(".ico icon") || m.includes(".png icon")),
    ).toBe(false);
  });
});
