// SPDX-License-Identifier: Apache-2.0
import { expect, spyOn, test } from "bun:test";
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
    // The generated index always links the repository navigation and inventories.
    await writeFile(join(migration, "source-map.json"), "{}");
    await writeFile(join(root, "docs/llms.txt"), "");
    await mkdir(join(root, "docs/reference/workspace"), { recursive: true });
    await writeFile(
      join(root, "docs/reference/workspace/documentation.json"),
      "{}",
    );
    // NTFS forbids "?" in file names; "#" alone still exercises literal query characters there.
    const literal =
      process.platform === "win32" ? "question#.md" : "question?#.md";
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
        source: `owner/${literal}`,
        kind: "documentation",
        target: `docs/guides/owner/${literal}`,
      },
    ];
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(root, entry.target);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "# Intro\n");
      }),
    );
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
      `[literal query characters](../guides/owner/${encodeURIComponent(literal)})`,
      "[external](https://example.com/Guide%20(draft).md?view=1#intro)",
      "[same page](#intro)",
      "`[inline code](missing.md)`",
      "```md\n[fenced code](missing.md)\n```",
    ].join("\n");
    await writeFile(join(migration, "links.md"), additional);
    expect(await runDocsLinks(["--root", root, "--web-routes", "--json"])).toBe(
      0,
    );
    await writeFile(
      join(migration, "broken.md"),
      '[missing](<../guides/owner/Missing (draft).md#intro> "Title")',
    );
    expect(await runDocsLinks(["--root", root, "--web-routes", "--json"])).toBe(
      1,
    );
    await writeFile(
      join(migration, "broken.md"),
      "[invalid encoding](../bad%ZZ.md)",
    );
    expect(await runDocsLinks(["--root", root, "--web-routes", "--json"])).toBe(
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit historical exclusions do not hide active failures or accept stale paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-links-exclusions-"));
  try {
    await mkdir(join(root, "docs/migration"), { recursive: true });
    await writeFile(
      join(root, "docs/migration/snapshot.md"),
      "[legacy](missing.md)",
    );
    await writeFile(join(root, "docs/active.md"), "# Active");
    const args = ["--root", root, "--json"];
    expect(await runDocsLinks(args)).toBe(1);
    const excludedArgs = [
      ...args,
      "--exclude-file",
      "docs/migration/snapshot.md",
    ];
    expect(await runDocsLinks(excludedArgs)).toBe(0);
    await writeFile(join(root, "docs/active.md"), "[broken](missing.md)");
    expect(await runDocsLinks(excludedArgs)).toBe(1);
    await Promise.all(
      ["docs/migration/absent.md", "docs/migration", "../outside.md"].map(
        (path) =>
          expect(
            runDocsLinks([...args, "--exclude-file", path]),
          ).rejects.toThrow("not an inventoried Markdown document"),
      ),
    );
    await expect(runDocsLinks([...args, "--exclude-file"])).rejects.toThrow(
      "requires a path",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage includes imported, historical and active pages unless individually excluded", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-links-coverage-"));
  const output: string[] = [];
  const logger = spyOn(console, "log").mockImplementation((message) =>
    output.push(String(message)),
  );
  const paths = [
    "docs/products/ai/README.md",
    "docs/reference/ai/guide.md",
    "docs/research/ai/review.md",
    "docs/migration/snapshot.md",
    "docs/products/ai/_source/README.md",
    "docs/apis/upstream-bun/guide.md",
    "docs/architecture/discord/architecture/upstreams/guide.md",
    "docs/plans/ai/2026-09-29-requirements.md",
  ];
  try {
    await Promise.all(
      paths.map(async (path) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), "[missing](absent.md)");
      }),
    );
    const args = ["--root", root, "--json"];
    expect(await runDocsLinks(args)).toBe(1);
    const full = JSON.parse(output.pop()!);
    expect(full.scanned).toBe(paths.length);
    expect(full.checked).toBe(paths.length);
    expect(full.checkedFiles.toSorted()).toEqual([...paths].toSorted());
    expect(full.broken).toBe(paths.length);
    expect(
      full.findings.map((finding: { file: string }) => finding.file).toSorted(),
    ).toEqual([...paths].toSorted());

    const scoped = [...args, "--exclude-file", "docs/migration/snapshot.md"];
    expect(await runDocsLinks(scoped)).toBe(1);
    const remaining = JSON.parse(output.pop()!);
    expect(remaining.scanned).toBe(paths.length);
    expect(remaining.checked).toBe(paths.length - 1);
    expect(remaining.excluded).toEqual(["docs/migration/snapshot.md"]);
    expect(remaining.checkedFiles).not.toContain("docs/migration/snapshot.md");
    expect(remaining.broken).toBe(paths.length - 1);

    await Promise.all(
      paths
        .filter((path) => path !== "docs/migration/snapshot.md")
        .map((path) => writeFile(join(root, path), "# Active")),
    );
    expect(await runDocsLinks(scoped)).toBe(0);
    const clean = JSON.parse(output.pop()!);
    expect(clean.checked + clean.excluded.length).toBe(clean.scanned);
    expect(clean.broken).toBe(0);
  } finally {
    logger.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test("declared imported upstream trees are skipped and dead backtick paths fail first-party docs", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-links-imported-"));
  const output: string[] = [];
  const logger = spyOn(console, "log").mockImplementation((message) =>
    output.push(String(message)),
  );
  try {
    await mkdir(join(root, "tools/config/docs"), { recursive: true });
    await mkdir(join(root, "docs/reference/upstream-x"), { recursive: true });
    await mkdir(join(root, "docs/reference/upstream-x/local"), {
      recursive: true,
    });
    await mkdir(join(root, "packages/real"), { recursive: true });
    await writeFile(join(root, "packages/real/index.ts"), "");
    await writeFile(
      join(root, "tools/config/docs/imported-upstream-docs.json"),
      JSON.stringify({
        trees: [
          {
            id: "x",
            include: ["docs/*/upstream-x/**"],
            except: ["docs/*/upstream-x/local/**"],
          },
        ],
      }),
    );
    await writeFile(
      join(root, "docs/reference/upstream-x/page.md"),
      "[up](absent.md) `packages/gone.ts`",
    );
    await writeFile(
      join(root, "docs/reference/upstream-x/local/ours.md"),
      "# Ours",
    );
    await writeFile(
      join(root, "docs/active.md"),
      "`packages/real/index.ts:3` and `packages/gone/x.ts`",
    );
    const args = ["--root", root, "--json"];
    expect(await runDocsLinks(args)).toBe(1);
    const report = JSON.parse(output.pop()!);
    expect(report.importedSkipped).toEqual({ x: 1 });
    expect(report.broken).toBe(0);
    expect(report.deadPaths).toEqual([
      { file: "docs/active.md", path: "packages/gone/x.ts" },
    ]);

    await writeFile(
      join(root, "docs/active.md"),
      "`packages/gone/x.ts` (not in repo)",
    );
    expect(await runDocsLinks(args)).toBe(0);
    await writeFile(
      join(root, "docs/active.md"),
      "<!-- docs-links: external-paths — another repository -->\n`packages/gone/x.ts`",
    );
    expect(await runDocsLinks(args)).toBe(0);
    await writeFile(
      join(root, "docs/reference/upstream-x/local/ours.md"),
      "[x](absent.md)",
    );
    expect(await runDocsLinks(args)).toBe(1);
  } finally {
    logger.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP operations do not become filesystem paths when tools is a repository root", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-links-mcp-tools-"));
  try {
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "tools"));
    const doc = join(root, "docs/protocol.md");
    await writeFile(doc, "MCP operations: `tools/list` and `tools/call`.\n");
    expect(await runDocsLinks(["--root", root, "--json"])).toBe(0);
    await writeFile(
      doc,
      "MCP `tools/call`; repository script `tools/missing.ts`.\n",
    );
    expect(await runDocsLinks(["--root", root, "--json"])).toBe(1);
    await writeFile(join(root, "tools/missing.ts"), "export {};\n");
    expect(await runDocsLinks(["--root", root, "--json"])).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
