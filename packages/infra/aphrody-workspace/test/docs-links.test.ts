// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderDocumentationIndex } from "../src/consolidation.ts";
import { markdownLinkDestinations, runDocsLinks } from "../src/docs-links.ts";

test("inline destinations include escaped labels, wrapped paths, balanced parentheses and titles", () => {
  expect(
    markdownLinkDestinations(String.raw`
[file\[1\]](../Guide%20%28draft%29%5B1%5D.md?view=1#intro "A title")
[wrapped](<../Guide (draft)[1].md?view=1#intro> 'A title')
[balanced](../Guide(draft).md (A title))
[escaped](../Guide\(draft\).md)
![image](../picture.png)
`),
  ).toEqual([
    "../Guide%20%28draft%29%5B1%5D.md?view=1#intro",
    "../Guide (draft)[1].md?view=1#intro",
    "../Guide(draft).md",
    "../Guide(draft).md",
    "../picture.png",
  ]);
});

test("generated migration index and URL metadata resolve actual local files", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-links-"));
  try {
    const migration = join(root, "docs/migration");
    await mkdir(migration, { recursive: true });
    await writeFile(join(migration, "document-import.json"), "{}");
    const entries = [
      {
        source: "owner/Guide (draft)[1].md",
        kind: "documentation",
        target: "docs/guides/owner/Guide (draft)[1].md",
      },
      {
        source: "owner/Guide(draft).md",
        kind: "documentation",
        target: "docs/guides/owner/Guide(draft).md",
      },
      {
        source: "owner/question?#.md",
        kind: "documentation",
        target: "docs/guides/owner/question?#.md",
      },
    ];
    for (const entry of entries) {
      const path = join(root, entry.target);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "# Intro\n");
    }
    await writeFile(
      join(migration, "IMPORTED-DOCS-INDEX.md"),
      renderDocumentationIndex(entries, root),
    );
    const additional = [
      '[query](../guides/owner/Guide%20%28draft%29%5B1%5D.md?view=1#intro "Title")',
      "[wrapped](<../guides/owner/Guide (draft)[1].md#intro> 'Title')",
      "[balanced](../guides/owner/Guide(draft).md)",
      "[virtual](file:///docs/guides/owner/Guide%20%28draft%29%5B1%5D.md?view=1#intro)",
      "[route](/guides/owner/Guide%20%28draft%29%5B1%5D?view=1#intro)",
      "[literal query characters](../guides/owner/question%3F%23.md)",
      "[external](https://example.com/Guide%20(draft).md?view=1#intro)",
      "[same page](#intro)",
      "`[inline code](missing.md)`",
      "```md\n[fenced code](missing.md)\n```",
    ].join("\n");
    await writeFile(join(migration, "links.md"), additional);
    expect(await runDocsLinks(["--root", root, "--web-routes", "--json"])).toBe(0);
    await writeFile(
      join(migration, "broken.md"),
      '[missing](<../guides/owner/Missing (draft).md#intro> "Title")',
    );
    expect(await runDocsLinks(["--root", root, "--web-routes", "--json"])).toBe(1);
    await writeFile(join(migration, "broken.md"), "[invalid encoding](../bad%ZZ.md)");
    expect(await runDocsLinks(["--root", root, "--web-routes", "--json"])).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
