// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { renderDocumentationIndex, runConsolidation } from "../../src/automation/consolidation.ts";

test("recorded-map indexing uses one canonical catalog without duplicating import paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-index-"));
  try {
    const entries = [
      {
        source: "missing-owner/docs/Guide (draft).md",
        kind: "documentation",
        target: "docs/guides/owner/Guide (draft).md",
      },
      {
        source: "missing-owner/README.md",
        kind: "documentation",
        target: "docs/products/owner/README.md",
        importedTarget: "docs/products/owner/_source/README.md",
      },
      {
        source: "missing-owner/src/lib.rs",
        kind: "rust-source",
        target: "crates/owner/lib.rs",
      },
      {
        source: "missing-owner/duplicate.md",
        kind: "documentation",
        target: null,
      },
    ];
    const migration = join(root, "docs/migration");
    await mkdir(migration, { recursive: true });
    const map = JSON.stringify({ entries });
    await writeFile(join(migration, "source-map.json"), map);
    await mkdir(join(root, "docs/reference/workspace"), { recursive: true });
    await writeFile(join(root, "docs/reference/workspace/documentation.json"), "{}");
    await writeFile(join(root, "docs/llms.txt"), "# Index\n");
    await Promise.all(
      entries.slice(0, 2).map(async entry => {
        const path = join(root, entry.importedTarget ?? entry.target!);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "# Imported document\n");
      }),
    );
    expect(
      await runConsolidation(["docs-index", "--aphrody-root", root, "--source-root", join(root, "absent-source")]),
    ).toBe(0);
    const index = join(migration, "IMPORTED-DOCS-INDEX.md");
    const content = await readFile(index, "utf8");
    expect(content).toContain("../reference/workspace/documentation.json");
    expect(content).not.toContain("Guide%20%28draft%29.md");
    expect(content).not.toContain("../products/owner/_source/README.md");
    expect(content).not.toContain("crates/owner/lib.rs");
    const links = [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]!);
    expect(links).toHaveLength(3);
    const linked = await Promise.all(links.map(href => stat(resolve(dirname(index), decodeURIComponent(href)))));
    for (const file of linked) expect(file.isFile()).toBe(true);
    expect(content).toBe(renderDocumentationIndex(entries, root));
    expect(await runConsolidation(["docs-index", "--aphrody-root", root])).toBe(0);
    expect(await readFile(index, "utf8")).toBe(content);
    expect(await readFile(join(migration, "source-map.json"), "utf8")).toBe(map);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("docs-index preserves a handwritten index", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-index-preserve-"));
  try {
    const migration = join(root, "docs/migration");
    await mkdir(migration, { recursive: true });
    await writeFile(join(migration, "source-map.json"), JSON.stringify({ entries: [] }));
    const index = join(migration, "IMPORTED-DOCS-INDEX.md");
    const handwritten = "# Maintained manually\n";
    await writeFile(index, handwritten);
    expect(await runConsolidation(["docs-index", "--aphrody-root", root])).toBe(1);
    expect(await readFile(index, "utf8")).toBe(handwritten);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("docs-index reports missing destinations instead of silently omitting them", async () => {
  const root = await mkdtemp(join(tmpdir(), "docs-index-missing-"));
  try {
    const migration = join(root, "docs/migration");
    await mkdir(migration, { recursive: true });
    await writeFile(
      join(migration, "source-map.json"),
      JSON.stringify({
        entries: [
          {
            source: "missing-owner/docs/missing.md",
            kind: "documentation",
            target: "docs/guides/owner/missing.md",
          },
        ],
      }),
    );
    expect(await runConsolidation(["docs-index", "--aphrody-root", root])).toBe(1);
    expect(await readFile(join(migration, "IMPORTED-DOCS-INDEX.md"), "utf8")).toContain(
      "../reference/workspace/documentation.json",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the pure renderer rejects destinations outside documentation", () => {
  expect(() =>
    renderDocumentationIndex(
      [
        {
          source: "owner/doc.md",
          kind: "documentation",
          target: "docs/../../outside.md",
        },
      ],
      "/workspace/aphrody",
    ),
  ).toThrow("escaped docs");
});
