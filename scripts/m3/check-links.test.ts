// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkLinks, links, slug } from "./check-links.ts";

const root = mkdtempSync(join(tmpdir(), "check-links-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

describe("link extraction", () => {
  test("inline links, images, reference definitions and HTML attributes; never code", () => {
    const found = links(
      '[a](./a.md) ![i](img/x.png "t")\n`[no](./code.md)`\n```\n[no](./fenced.md)\n```\n[ref]: ../b.md\n<img src="./c.png">\n',
    ).map((l) => l.link);
    expect(found).toEqual(["./a.md", "img/x.png", "../b.md", "./c.png"]);
  });
  test("GitHub heading slugs", () => {
    expect(slug("Build and link")).toBe("build-and-link");
    expect(slug("`m3 new` — scaffold")).toBe("m3-new--scaffold");
  });
});

describe("checkLinks on a synthetic repository", () => {
  write("package.json", "{}");
  write(
    "docs/a.md",
    "# Title\n\n## Build and link\n\n[ok](./b.md#section) [self](#build-and-link) [gone](./gone.md) [bad anchor](./b.md#nope) [url](https://x.y/z)\n",
  );
  write("docs/b.md", "## Section\n");

  test("missing files and anchors are errors; valid links and URLs pass", () => {
    const messages = checkLinks(root).map(
      (f) => `${f.file}:${f.line} ${f.link} ${f.message}`,
    );
    expect(messages).toEqual([
      "docs/a.md:5 ./gone.md target does not exist",
      "docs/a.md:5 ./b.md#nope anchor #nope not found in docs/b.md",
    ]);
  });
});
